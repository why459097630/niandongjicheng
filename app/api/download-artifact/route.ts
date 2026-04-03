import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getBuildRecordByRunId,
  insertOperationLogOnce,
  syncAuthUserProfile,
  updateBuildRecordByRunId,
} from "@/lib/build/storage";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function githubRequest(
  url: string,
  init: RequestInit & { token: string },
): Promise<Response> {
  const { token, headers, ...rest } = init;

  return fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      ...(headers || {}),
    },
    cache: "no-store",
    redirect: "manual",
  });
}

async function readRemoteStatusFile(runId: string) {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");

  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/contents/requests/${encodeURIComponent(runId)}/status.json?ref=${encodeURIComponent(branch)}`,
    {
      method: "GET",
      token,
    },
  );

  if (response.status === 404) {
    return null;
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to read status.json: ${text}`);
  }

  const payload = JSON.parse(text) as {
    content?: string;
    encoding?: string;
  };

  if (!payload.content) {
    throw new Error("status.json content is empty.");
  }

  const decoded =
    payload.encoding === "base64"
      ? Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8")
      : payload.content;

  return JSON.parse(decoded) as {
    status?: string;
    artifactName?: string | null;
    workflowRunId?: string | number | null;
    downloadUrl?: string | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error("NDJC download-artifact: failed to sync profile", profileError);
    }

    const runId = request.nextUrl.searchParams.get("runId")?.trim() || "";

    if (!runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing runId.",
        },
        { status: 400 },
      );
    }

    const localRecord = await getBuildRecordByRunId(supabase, runId);
    const status = await readRemoteStatusFile(runId);

    if (!status) {
      return NextResponse.json(
        {
          ok: false,
          error: "Build status file not found.",
        },
        { status: 404 },
      );
    }

    if (status.status !== "success") {
      return NextResponse.json(
        {
          ok: false,
          error: "Build is not ready for download yet.",
        },
        { status: 409 },
      );
    }

    const token = getRequiredEnv("GH_TOKEN");
    const owner = getRequiredEnv("GH_OWNER");
    const repo = getRequiredEnv("GH_REPO");

    const workflowRunId = String(status.workflowRunId || "").trim();
    const artifactName = String(status.artifactName || "").trim();

    if (!workflowRunId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing workflowRunId in status.json.",
        },
        { status: 500 },
      );
    }

    if (!artifactName) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing artifactName in status.json.",
        },
        { status: 500 },
      );
    }

    const artifactsResponse = await githubRequest(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${encodeURIComponent(workflowRunId)}/artifacts`,
      {
        method: "GET",
        token,
      },
    );

    const artifactsText = await artifactsResponse.text();

    if (!artifactsResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Failed to list artifacts: ${artifactsText}`,
        },
        { status: 500 },
      );
    }

    const artifactsPayload = JSON.parse(artifactsText) as {
      artifacts?: Array<{
        id: number;
        name: string;
        expired: boolean;
        archive_download_url: string;
      }>;
    };

    const artifact = (artifactsPayload.artifacts || []).find(
      (item) => item.name === artifactName && !item.expired,
    );

    if (!artifact) {
      await insertOperationLogOnce(
        supabase,
        {
          userId: user.id,
          buildId: localRecord?.id ?? null,
          runId,
          eventName: "download_failed",
          pagePath: "/api/download-artifact",
          metadata: {
            source: "download_artifact_route",
            reason: `artifact_not_found:${artifactName}`,
          },
        },
        { dedupeSeconds: 30 },
      ).catch(() => null);

      return NextResponse.json(
        {
          ok: false,
          error: `Artifact not found or expired: ${artifactName}`,
        },
        { status: 404 },
      );
    }

    await updateBuildRecordByRunId(supabase, runId, {
      artifactUrl: artifact.archive_download_url,
      statusSource: "github_status_json",
      lastSyncedAt: new Date().toISOString(),
    }).catch(() => null);

    const downloadResponse = await githubRequest(artifact.archive_download_url, {
      method: "GET",
      token,
    });

    const redirectLocation = downloadResponse.headers.get("location");

    if (!redirectLocation) {
      const fallbackBody = await downloadResponse.text();

      await insertOperationLogOnce(
        supabase,
        {
          userId: user.id,
          buildId: localRecord?.id ?? null,
          runId,
          eventName: "download_failed",
          pagePath: "/api/download-artifact",
          metadata: {
            source: "download_artifact_route",
            reason: "missing_redirect_location",
          },
        },
        { dedupeSeconds: 30 },
      ).catch(() => null);

      return NextResponse.json(
        {
          ok: false,
          error: `GitHub did not return redirect download URL: ${fallbackBody}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.redirect(redirectLocation, { status: 302 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown download error.",
      },
      { status: 500 },
    );
  }
}
