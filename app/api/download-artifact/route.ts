import { NextRequest, NextResponse } from "next/server";

const GH_OWNER = process.env.GH_OWNER!;
const GH_REPO = process.env.GH_REPO!;
const GH_PAT = process.env.GH_PAT || process.env.GH_TOKEN!;

async function getStatusJson(runId: string) {
  const url = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${process.env.GH_BRANCH || "main"}/requests/${runId}/status.json`;

  const res = await fetch(url, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch status.json: ${res.status}`);
  }

  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get("runId");

    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    const status = await getStatusJson(runId);

    if (status.status !== "success") {
      return NextResponse.json(
        { error: "Build is not ready for download yet." },
        { status: 409 }
      );
    }

    const workflowRunId = String(status.workflowRunId || "").trim();
    const artifactName = String(status.artifactName || "").trim();

    if (!workflowRunId || !artifactName) {
      return NextResponse.json(
        { error: "Missing workflowRunId or artifactName in status.json" },
        { status: 500 }
      );
    }

    const artifactsRes = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${workflowRunId}/artifacts`,
      {
        headers: {
          Authorization: `Bearer ${GH_PAT}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      }
    );

    if (!artifactsRes.ok) {
      const text = await artifactsRes.text();
      return NextResponse.json(
        { error: `Failed to list artifacts: ${artifactsRes.status}`, detail: text },
        { status: 500 }
      );
    }

    const artifactsData = await artifactsRes.json();
    const artifact = (artifactsData.artifacts || []).find(
      (item: any) => item.name === artifactName && !item.expired
    );

    if (!artifact) {
      return NextResponse.json(
        { error: `Artifact not found: ${artifactName}` },
        { status: 404 }
      );
    }

    const downloadRes = await fetch(artifact.archive_download_url, {
      headers: {
        Authorization: `Bearer ${GH_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
    });

    const location = downloadRes.headers.get("location");

    if (!location) {
      return NextResponse.json(
        { error: "GitHub did not return a redirect download URL." },
        { status: 500 }
      );
    }

    return NextResponse.redirect(location, 302);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown download error" },
      { status: 500 }
    );
  }
}
