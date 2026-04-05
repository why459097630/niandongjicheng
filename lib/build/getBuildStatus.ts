import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBuildRecordByRunId,
  insertOperationLogOnce,
  updateBuildRecordByRunId,
} from "./storage";
import {
  BuildStage,
  BuildStatusResponse,
  BuildStatusValue,
  InternalBuildRecord,
} from "./types";

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
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    cache: "no-store",
  });
}

function decodeGithubContent(content: string): string {
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
}

function normalizeRemoteStage(value: unknown): BuildStage | undefined {
  if (typeof value !== "string") return undefined;

  const stage = value.trim();

  if (stage === "preparing_request") return "preparing_request";
  if (stage === "processing_identity") return "processing_identity";
  if (stage === "matching_logic_module") return "matching_logic_module";
  if (stage === "applying_ui_pack") return "applying_ui_pack";
  if (stage === "preparing_services") return "preparing_services";
  if (stage === "building_apk") return "building_apk";
  if (stage === "success") return "success";
  if (stage === "failed") return "failed";

  return undefined;
}

function normalizeRemoteStatus(
  value: unknown,
  stage: BuildStage | undefined,
): BuildStatusValue | undefined {
  if (value === "queued") return "queued";
  if (value === "running") return "running";
  if (value === "success") return "success";
  if (value === "failed") return "failed";

  if (stage === "success") return "success";
  if (stage === "failed") return "failed";

  return undefined;
}

function stageToStatus(stage: BuildStage | undefined): BuildStatusValue {
  if (stage === "success") return "success";
  if (stage === "failed") return "failed";
  if (stage === "preparing_request") return "queued";
  return "running";
}

async function readRemoteStatusFile(runId: string): Promise<Record<string, unknown> | null> {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");
  const path = `requests/${runId}/status.json`;

  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`,
    {
      method: "GET",
      token,
    },
  );

  if (response.status === 404) {
    return null;
  }

  const data = (await response.json()) as {
    content?: string;
  };

  if (!response.ok) {
    throw new Error(`Failed to read remote status file: ${JSON.stringify(data)}`);
  }

  if (!data.content) {
    return null;
  }

  return JSON.parse(decodeGithubContent(data.content)) as Record<string, unknown>;
}

function mapRecordToResponse(
  record: InternalBuildRecord,
  extra?: {
    adminName?: string;
    workflowStatus?: string | null;
    workflowConclusion?: string | null;
  },
): BuildStatusResponse {
  return {
    ok: true,
    runId: record.runId,
    stage: record.stage,
    message: record.error || record.message,
    artifactUrl: record.artifactUrl,
    downloadUrl: record.downloadUrl,
    error: record.error,
    appName: record.appName,
    adminName: extra?.adminName,
    storeId: record.storeId ?? null,
    moduleName: record.moduleName,
    uiPackName: record.uiPackName,
    plan: record.plan,
    mode: record.mode,
    createdAt: record.createdAt,
    requestPath: record.requestPath ?? `requests/${record.runId}/status.json`,
    workflowRunId: record.workflowRunId ?? null,
    workflowStatus: extra?.workflowStatus ?? record.workflowStatus ?? null,
    workflowConclusion: extra?.workflowConclusion ?? record.workflowConclusion ?? null,
    workflowUrl: record.workflowUrl ?? null,
  };
}

function mergeStatus(
  runId: string,
  localRecord: InternalBuildRecord | null,
  remote: Record<string, unknown>,
): BuildStatusResponse {
  return {
    ok: true,
    runId,
    stage: normalizeRemoteStage(remote.stage) || localRecord?.stage,
    message:
      (typeof remote.message === "string" ? remote.message : null) ??
      localRecord?.message ??
      null,
    artifactUrl:
      (typeof remote.artifactUrl === "string" ? remote.artifactUrl : null) ??
      localRecord?.artifactUrl ??
      null,
    downloadUrl:
      (typeof remote.downloadUrl === "string" ? remote.downloadUrl : null) ??
      localRecord?.downloadUrl ??
      null,
    error:
      (typeof remote.error === "string" ? remote.error : null) ??
      localRecord?.error ??
      null,
    appName:
      (typeof remote.appName === "string" ? remote.appName : "") ||
      localRecord?.appName,
    adminName:
      (typeof remote.adminName === "string" ? remote.adminName : "") ||
      localRecord?.adminName,
    storeId:
      (typeof remote.storeId === "string" ? remote.storeId : "") ||
      localRecord?.storeId,
    moduleName:
      (typeof remote.moduleName === "string" ? remote.moduleName : "") ||
      localRecord?.moduleName,
    uiPackName:
      (typeof remote.uiPackName === "string" ? remote.uiPackName : "") ||
      localRecord?.uiPackName,
    plan:
      (typeof remote.plan === "string" ? remote.plan : "") ||
      localRecord?.plan,
    mode: localRecord?.mode,
    createdAt:
      (typeof remote.createdAt === "string" ? remote.createdAt : "") ||
      localRecord?.createdAt,
    requestPath:
      (typeof remote.requestPath === "string" ? remote.requestPath : null) ??
      localRecord?.requestPath ??
      `requests/${runId}/status.json`,
    workflowRunId:
      (typeof remote.workflowRunId === "number" ? remote.workflowRunId : null) ??
      localRecord?.workflowRunId ??
      null,
    workflowStatus:
      (typeof remote.workflowStatus === "string" ? remote.workflowStatus : null) ??
      localRecord?.workflowStatus ??
      null,
    workflowConclusion:
      (typeof remote.workflowConclusion === "string"
        ? remote.workflowConclusion
        : null) ??
      localRecord?.workflowConclusion ??
      null,
    workflowUrl:
      (typeof remote.workflowUrl === "string" ? remote.workflowUrl : null) ??
      localRecord?.workflowUrl ??
      null,
  };
}

export async function getBuildStatus(
  supabase: SupabaseClient,
  runId: string,
): Promise<BuildStatusResponse> {
  const localRecord = await getBuildRecordByRunId(supabase, runId);
  const remoteStatus = await readRemoteStatusFile(runId);

  if (remoteStatus) {
    const merged = mergeStatus(runId, localRecord, remoteStatus);
    const stage = merged.stage || localRecord?.stage || "preparing_request";
    const status =
      normalizeRemoteStatus(remoteStatus.status, stage) || stageToStatus(stage);

    if (localRecord) {
      const synced = await updateBuildRecordByRunId(supabase, runId, {
        appName: merged.appName,
        moduleName: merged.moduleName,
        uiPackName: merged.uiPackName,
        plan: merged.plan,
        storeId: merged.storeId ?? null,
        status,
        stage,
        message: merged.message ?? null,
        workflowRunId: merged.workflowRunId ?? null,
        workflowUrl: merged.workflowUrl ?? null,
        artifactUrl: merged.artifactUrl ?? null,
        downloadUrl: merged.downloadUrl ?? null,
        error: merged.error ?? null,
        statusSource: "github_status_json",
        lastSyncedAt: new Date().toISOString(),
      });

      if (status === "failed" && localRecord.userId) {
        await insertOperationLogOnce(
          supabase,
          {
            userId: localRecord.userId,
            buildId: localRecord.id,
            runId,
            eventName: "build_failed",
            pagePath: "/generating",
            metadata: {
              source: "status_sync",
              reason: merged.error ?? merged.message ?? "build_failed",
            },
          },
          { dedupeSeconds: 60 },
        ).catch(() => null);
      }

      return mapRecordToResponse(synced, {
        adminName: merged.adminName,
        workflowStatus: merged.workflowStatus ?? null,
        workflowConclusion: merged.workflowConclusion ?? null,
      });
    }

    return merged;
  }

  if (!localRecord) {
    return {
      ok: false,
      error: "Build record not found.",
    };
  }

  return mapRecordToResponse(localRecord);
}
