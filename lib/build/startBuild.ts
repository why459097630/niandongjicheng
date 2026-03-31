import { getBuildRecord, upsertBuildRecord } from "./storage";
import { BuildRequest, InternalBuildRecord, StartBuildResponse } from "./types";

function normalizePlan(plan: string): string {
  const value = plan.trim().toLowerCase();
  if (!value) return "pro";
  return value;
}

function getModeFromPlan(plan: string): "Free Trial" | "Paid Purchase" {
  const normalized = normalizePlan(plan);
  return normalized === "free" ? "Free Trial" : "Paid Purchase";
}

function createRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:.]/g, "").replace(".000Z", "Z");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ndjc-${iso}-${random}`;
}

function createMockDownloadUrl(runId: string): string {
  return `/api/build-status?runId=${encodeURIComponent(runId)}&download=1`;
}

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function base64EncodeUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function buildAssemblyLocalJson(input: BuildRequest & { storeId: string }): string {
  const template =
    input.module?.trim() === "feature-showcase"
      ? "core-skeleton"
      : "core-skeleton";

  const uiPack =
    input.uiPack?.trim() || "ui-pack-showcase-greenpink";

  const moduleName =
    input.module?.trim() || "feature-showcase";

  const appName =
    input.appName?.trim() || "Untitled App";

  const packageName =
    `com.ndjc.apps.${runSafeSlug(appName)}.${runSafeSlug(input.storeId).slice(-12) || "a000000"}`;

  const assembly = {
    template,
    uiPack,
    modules: [moduleName],
    appName,
    packageName,
    versionCode: 1,
    versionName: "1.0.0",
    storeId: input.storeId,
  };

  return JSON.stringify(assembly, null, 2);
}

function runSafeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

  if (!normalized) return "app";
  if (/^[a-z]/.test(normalized)) return normalized;
  return `a${normalized}`;
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

async function uploadBuildRequestToRepo(
  input: BuildRequest & { storeId: string },
  runId: string,
): Promise<void> {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");

  const assemblyJson = buildAssemblyLocalJson(input);
  const requestMeta = {
    runId,
    appName: input.appName,
    module: input.module,
    uiPack: input.uiPack,
    plan: input.plan,
    storeId: input.storeId,
    adminName: input.adminName || "",
    iconUrl: input.iconUrl || null,
    createdAt: new Date().toISOString(),
  };

  const files = [
    {
      path: `requests/${runId}/assembly.local.json`,
      content: assemblyJson,
      message: `NDJC request ${runId}: add assembly.local.json`,
    },
    {
      path: `requests/${runId}/request.json`,
      content: JSON.stringify(requestMeta, null, 2),
      message: `NDJC request ${runId}: add request.json`,
    },
  ];

  for (const file of files) {
    const response = await githubRequest(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g, "/")}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify({
          message: file.message,
          content: base64EncodeUtf8(file.content),
          branch,
        }),
      },
    );

    const data = await response.text();

    if (!response.ok) {
      throw new Error(`Failed to upload ${file.path}: ${data}`);
    }
  }
}

async function triggerBuildWorkflow(runId: string): Promise<void> {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");
  const workflowId = getRequiredEnv("WORKFLOW_ID");

  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      token,
      body: JSON.stringify({
        ref: branch,
        inputs: {
          run_id: runId,
        },
      }),
    },
  );

  const data = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to dispatch workflow: ${data}`);
  }
}

export async function startBuild(input: BuildRequest): Promise<StartBuildResponse> {
  const appName = input.appName?.trim() || "Untitled App";
  const moduleName = input.module?.trim() || "feature-showcase";
  const uiPackName = input.uiPack?.trim() || "ui-pack-showcase-greenpink";
  const plan = normalizePlan(input.plan || "pro");
  const adminName = input.adminName?.trim() || "";
  const storeId = input.storeId?.trim() || "";
  const runId = createRunId();
  const now = new Date().toISOString();

  if (!storeId) {
    return {
      ok: false,
      error: "storeId is required.",
    };
  }

  const record: InternalBuildRecord = {
    runId,
    appName,
    moduleName,
    uiPackName,
    plan,
    mode: getModeFromPlan(plan),
    iconUrl: input.iconUrl || null,
    adminName,
    storeId,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    stage: "preparing_request",
    message: "Build request accepted. Preparing NDJC pipeline.",
    artifactUrl: createMockDownloadUrl(runId),
    downloadUrl: createMockDownloadUrl(runId),
    error: null,
  };

  upsertBuildRecord(record);

  const saved = getBuildRecord(runId);
  if (!saved) {
    return {
      ok: false,
      error: "Failed to create build record.",
    };
  }

  try {
    console.log("NDJC startBuild: uploading request files", {
      runId,
      appName,
      moduleName,
      uiPackName,
      plan,
      storeId,
    });

    await uploadBuildRequestToRepo(
      {
        ...input,
        appName,
        module: moduleName,
        uiPack: uiPackName,
        plan,
        adminName,
        storeId,
      },
      runId,
    );

    const afterUpload: InternalBuildRecord = {
      ...saved,
      updatedAt: new Date().toISOString(),
      status: "running",
      stage: "processing_identity",
      message: "Build request uploaded. Triggering packaging workflow.",
      error: null,
    };

    upsertBuildRecord(afterUpload);

    console.log("NDJC startBuild: dispatching workflow", {
      runId,
    });

    await triggerBuildWorkflow(runId);

    const afterDispatch: InternalBuildRecord = {
      ...afterUpload,
      updatedAt: new Date().toISOString(),
      status: "running",
      stage: "matching_module",
      message: "Packaging workflow dispatched successfully.",
      error: null,
    };

    upsertBuildRecord(afterDispatch);

    return {
      ok: true,
      runId,
      stage: afterDispatch.stage,
      message: afterDispatch.message,
      storeId: afterDispatch.storeId,
    };
  } catch (error) {
    const failed: InternalBuildRecord = {
      ...saved,
      updatedAt: new Date().toISOString(),
      status: "failed",
      stage: "failed",
      message: "Failed to trigger packaging workflow.",
      error: error instanceof Error ? error.message : "Failed to trigger packaging workflow.",
    };

    upsertBuildRecord(failed);

    console.error("NDJC startBuild: failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: failed.error || "Failed to trigger packaging workflow.",
    };
  }
}
