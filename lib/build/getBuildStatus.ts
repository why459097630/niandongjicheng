import { getBuildRecord } from "./storage";
import { BuildStatusResponse, InternalBuildRecord } from "./types";

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

function normalizeRemoteStage(value: unknown): BuildStatusResponse["stage"] | undefined {
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

function mergeStatus(
  runId: string,
  localRecord: InternalBuildRecord | null,
  remote: Record<string, unknown>,
): BuildStatusResponse {
  return {
    ok: true,
    runId,
    stage: normalizeRemoteStage(remote.stage) || localRecord?.stage,
    message: (remote.message as string) || localRecord?.message,
    artifactUrl:
      (remote.artifactUrl as string | null | undefined) ??
      localRecord?.artifactUrl ??
      null,
    downloadUrl:
      (remote.downloadUrl as string | null | undefined) ??
      localRecord?.downloadUrl ??
      null,
    error:
      (remote.error as string | null | undefined) ??
      localRecord?.error ??
      undefined,
    appName: (remote.appName as string) || localRecord?.appName,
    adminName: (remote.adminName as string) || localRecord?.adminName,
    storeId: (remote.storeId as string) || localRecord?.storeId,
    moduleName: (remote.moduleName as string) || localRecord?.moduleName,
    uiPackName: (remote.uiPackName as string) || localRecord?.uiPackName,
    plan: (remote.plan as string) || localRecord?.plan,
    mode: (remote.mode as BuildStatusResponse["mode"]) || localRecord?.mode,
    createdAt: (remote.createdAt as string) || localRecord?.createdAt,
    requestPath:
      (remote.requestPath as string | null | undefined) ??
      localRecord?.requestPath ??
      `requests/${runId}/status.json`,
    workflowRunId:
      (remote.workflowRunId as number | null | undefined) ??
      localRecord?.workflowRunId ??
      null,
    workflowStatus:
      (remote.workflowStatus as string | null | undefined) ??
      localRecord?.workflowStatus ??
      null,
    workflowConclusion:
      (remote.workflowConclusion as string | null | undefined) ??
      localRecord?.workflowConclusion ??
      null,
    workflowUrl:
      (remote.workflowUrl as string | null | undefined) ??
      localRecord?.workflowUrl ??
      null,
  };
}

export async function getBuildStatus(runId: string): Promise<BuildStatusResponse> {
  const localRecord = getBuildRecord(runId);

  const remoteStatus = await readRemoteStatusFile(runId);

  if (remoteStatus) {
    return mergeStatus(runId, localRecord, remoteStatus);
  }

  if (!localRecord) {
    return {
      ok: false,
      error: "Build record not found.",
    };
  }

  return {
    ok: true,
    runId: localRecord.runId,
    stage: localRecord.stage,
    message: localRecord.error || localRecord.message,
    artifactUrl: localRecord.artifactUrl,
    downloadUrl: localRecord.downloadUrl,
    error: localRecord.error || undefined,
    appName: localRecord.appName,
    moduleName: localRecord.moduleName,
    uiPackName: localRecord.uiPackName,
    plan: localRecord.plan,
    mode: localRecord.mode,
    createdAt: localRecord.createdAt,
    adminName: localRecord.adminName,
    storeId: localRecord.storeId,
    requestPath: localRecord.requestPath ?? `requests/${runId}/status.json`,
    workflowRunId: localRecord.workflowRunId ?? null,
    workflowStatus: localRecord.workflowStatus ?? null,
    workflowConclusion: localRecord.workflowConclusion ?? null,
    workflowUrl: localRecord.workflowUrl ?? null,
  };
}
