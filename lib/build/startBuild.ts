import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { resolveFirebaseProjectAssignment } from "../firebase/projectPool";
import { releaseNextQueuedBuild } from "./releaseNextQueuedBuild";
import {
  getBuildRecordByRunId,
  insertBuildRecord,
  insertOperationLog,
  insertOperationLogOnce,
  updateBuildRecordByRunId,
} from "./storage";
import { BuildPriority, BuildRequest, StartBuildResponse } from "./types";

function normalizePlan(plan: string): string {
  const value = plan.trim().toLowerCase();
  if (!value) return "pro";
  return value;
}

function normalizeBuildPriority(
  value: BuildPriority | undefined,
  plan: string,
): BuildPriority {
  if (value === "admin") return "admin";
  if (value === "paid") return "paid";
  if (value === "free") return "free";
  return normalizePlan(plan) === "free" ? "free" : "paid";
}

function createRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:.]/g, "").replace(".000Z", "Z");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ndjc-${iso}-${random}`;
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

function parseDataUrl(
  value: string,
): { base64Content: string; extension: string } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    return null;
  }

  const mimeType = match[1].trim().toLowerCase();
  const base64Content = match[2].trim();

  let extension = "png";

  if (mimeType === "image/png") {
    extension = "png";
  } else if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    extension = "jpg";
  } else if (mimeType === "image/svg+xml") {
    extension = "svg";
  }

  return {
    base64Content,
    extension,
  };
}

function buildPrivacyPolicyUrl(input: BuildRequest & { storeId: string }): string {
  const provided = input.privacyUrl?.trim();

  if (provided) {
    return provided;
  }

  const siteUrl = (process.env.SITE_URL || "").trim().replace(/\/+$/, "");
  const baseUrl = siteUrl || "https://你的域名";

  return `${baseUrl}/privacy/${encodeURIComponent(input.storeId)}`;
}

async function resolveNdjcLoginEmail(
  userId: string,
  fallbackEmail: string,
): Promise<string> {
  const normalizedFallback = fallbackEmail.trim().toLowerCase();
  if (!userId.trim()) {
    return normalizedFallback;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("email")
      .eq("id", userId.trim())
      .maybeSingle();

    if (error) {
      throw error;
    }

    const email = String(data?.email || "").trim().toLowerCase();
    return email || normalizedFallback;
  } catch {
    return normalizedFallback;
  }
}

async function upsertPrivacyPageRecord(input: {
  userId: string;
  storeId: string;
  appName: string;
  merchantEmail: string;
  effectiveDate: string;
}): Promise<string> {
  const admin = createAdminClient();

  const { data: existing, error: existingError } = await admin
    .from("privacy_pages")
    .select("effective_date")
    .eq("store_id", input.storeId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || "Failed to load privacy page record.");
  }

  const effectiveDate = String(existing?.effective_date || "").trim() || input.effectiveDate;

  const { error: upsertError } = await admin
    .from("privacy_pages")
    .upsert(
      {
        user_id: input.userId,
        store_id: input.storeId,
        app_name: input.appName,
        merchant_email: input.merchantEmail,
        effective_date: effectiveDate,
      },
      { onConflict: "store_id" },
    );

  if (upsertError) {
    throw new Error(upsertError.message || "Failed to save privacy page record.");
  }

  return effectiveDate;
}
function buildAssemblyLocalJson(input: BuildRequest & { storeId: string }): string {
  const template =
    input.module?.trim() === "feature-showcase"
      ? "core-skeleton"
      : "core-skeleton";

  const uiPack = input.uiPack?.trim() || "ui-pack-showcase-greenpink";
  const moduleName = input.module?.trim() || "feature-showcase";
  const appName = input.appName?.trim() || "Untitled App";
  const packageName =
    input.packageName?.trim() || derivePackageName(appName, input.storeId);
  const merchantEmail =
    input.merchantEmail?.trim() ||
    input.adminName?.trim().toLowerCase() ||
    "";
  const privacyUrl = buildPrivacyPolicyUrl({
    ...input,
    appName,
    merchantEmail,
  });

  const assembly = {
    template,
    uiPack,
    modules: [moduleName],
    appName,
    packageName,
    versionCode: 1,
    versionName: "1.0.0",
    storeId: input.storeId,
    merchantEmail,
    privacyUrl,
    plan: input.plan || "pro",
    firebaseProjectId: input.firebaseProjectId || null,
    firebaseCredentialsEnvKey: input.firebaseCredentialsEnvKey || null,
  };

  return JSON.stringify(assembly, null, 2);
}

function buildRemoteStatusJson(
  input: BuildRequest & { storeId: string },
  runId: string,
  initial: {
    status: "queued" | "running";
    stage: "queued" | "preparing_request";
    message: string;
  },
): string {
  const appName = input.appName?.trim() || "Untitled App";
  const moduleName = input.module?.trim() || "feature-showcase";
  const uiPackName = input.uiPack?.trim() || "ui-pack-showcase-greenpink";
  const plan = normalizePlan(input.plan || "pro");
  const now = new Date().toISOString();

  const status = {
    runId,
    appName,
    moduleName,
    uiPackName,
    plan,
    storeId: input.storeId,
    adminName: input.adminName || "",
    createdAt: now,
    updatedAt: now,
    status: initial.status,
    stage: initial.stage,
    message: initial.message,
    artifactUrl: null,
    downloadUrl: null,
    error: null,
    workflowRunId: null,
    workflowStatus: "queued",
    workflowConclusion: null,
    workflowUrl: null,
    requestPath: `requests/${runId}/status.json`,
  };

  return JSON.stringify(status, null, 2);
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

function derivePackageName(appName: string, storeId: string): string {
  return `com.ndjc.apps.${runSafeSlug(appName)}.${runSafeSlug(storeId).slice(-12) || "a000000"}`;
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
  initial: {
    status: "queued" | "running";
    stage: "queued" | "preparing_request";
    message: string;
  },
): Promise<void> {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");

  const assemblyJson = buildAssemblyLocalJson(input);
  const statusJson = buildRemoteStatusJson(input, runId, initial);
  const requestMeta = {
    runId,
    appName: input.appName,
    module: input.module,
    uiPack: input.uiPack,
    plan: input.plan,
    storeId: input.storeId,
    userId: input.userId || "",
    adminName: input.adminName || "",
    merchantEmail:
      input.merchantEmail?.trim() ||
      input.adminName?.trim().toLowerCase() ||
      "",
    privacyUrl: buildPrivacyPolicyUrl({
      ...input,
      storeId: input.storeId,
    }),
    iconUrl: input.iconUrl || null,
    iconDataUrl: input.iconDataUrl || null,
    packageName: input.packageName || null,
    firebaseProjectId: input.firebaseProjectId || null,
    firebaseCredentialsEnvKey: input.firebaseCredentialsEnvKey || null,
    firebaseProjectBucket: input.firebaseProjectBucket ?? null,
    firebaseProjectSlot: input.firebaseProjectSlot ?? null,
    createdAt: new Date().toISOString(),
    requestPath: `requests/${runId}/status.json`,
  };

  const iconUpload = input.iconDataUrl ? parseDataUrl(input.iconDataUrl) : null;

  const files: Array<{
    path: string;
    content: string;
    message: string;
    isBase64Binary?: boolean;
  }> = [
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
    {
      path: `requests/${runId}/status.json`,
      content: statusJson,
      message: `NDJC request ${runId}: add status.json`,
    },
  ];

  if (iconUpload) {
    files.push({
      path: `requests/${runId}/icon.${iconUpload.extension}`,
      content: iconUpload.base64Content,
      message: `NDJC request ${runId}: add icon.${iconUpload.extension}`,
      isBase64Binary: true,
    });

    files.push({
      path: `requests/${runId}/icon.png`,
      content: iconUpload.base64Content,
      message: `NDJC request ${runId}: add icon.png`,
      isBase64Binary: true,
    });
  }

  for (const file of files) {
    const response = await githubRequest(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g, "/")}`,
      {
        method: "PUT",
        token,
        body: JSON.stringify({
          message: file.message,
          content: file.isBase64Binary ? file.content : base64EncodeUtf8(file.content),
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



export async function startBuild(
  supabase: SupabaseClient,
  input: BuildRequest,
): Promise<StartBuildResponse> {
  const appName = input.appName?.trim() || "Untitled App";
  const moduleName = input.module?.trim() || "feature-showcase";
  const uiPackName = input.uiPack?.trim() || "ui-pack-showcase-greenpink";
  const plan = normalizePlan(input.plan || "pro");
  const buildPriority = normalizeBuildPriority(input.buildPriority, plan);
  const adminName = input.adminName?.trim() || "";
  const storeId = input.storeId?.trim() || "";
  const userId = input.userId?.trim() || "";
  const runId = input.runId?.trim() || createRunId();
  const fallbackMerchantEmail =
    input.merchantEmail?.trim().toLowerCase() ||
    adminName.trim().toLowerCase() ||
    "";
  if (!storeId) {
    return {
      ok: false,
      error: "storeId is required.",
    };
  }

  if (!userId) {
    return {
      ok: false,
      error: "userId is required.",
    };
  }

  const packageName =
    input.packageName?.trim() || derivePackageName(appName, storeId);

  const merchantEmail = await resolveNdjcLoginEmail(userId, fallbackMerchantEmail);

  const existingRecord = await getBuildRecordByRunId(supabase, runId);

  if (
    existingRecord &&
    (existingRecord.status === "queued" ||
      existingRecord.status === "running" ||
      existingRecord.status === "success")
  ) {
    return {
      ok: true,
      runId,
      stage: existingRecord.stage,
      message: existingRecord.message,
      storeId: existingRecord.storeId ?? null,
    };
  }

  const saved = existingRecord
    ? await updateBuildRecordByRunId(supabase, runId, {
        appName,
        moduleName,
        uiPackName,
        plan,
        buildPriority,
        storeId,
        status: "queued",
        stage: "queued",
        message: "Your request has been received and is waiting for an available build slot.",
        workflowRunId: null,
        workflowUrl: null,
        artifactUrl: null,
        downloadUrl: null,
        error: null,
        failedStep: null,
        completedAt: null,
        statusSource: "local_api",
        lastSyncedAt: null,
      })
    : await insertBuildRecord(supabase, {
        userId,
        runId,
        appName,
        moduleName,
        uiPackName,
        plan,
        buildPriority,
        storeId,
        status: "queued",
        stage: "queued",
        message: "Your request has been received and is waiting for an available build slot.",
        workflowRunId: null,
        workflowUrl: null,
        artifactUrl: null,
        downloadUrl: null,
        error: null,
        statusSource: "local_api",
        lastSyncedAt: null,
      });

  const firebaseAssignment = await resolveFirebaseProjectAssignment(supabase, {
    plan,
    storeId,
    packageName,
  });

  await insertOperationLog(supabase, {
    userId,
    buildId: saved.id,
    runId,
    eventName: "build_started",
    pagePath: "/builder",
    metadata: {
      appName,
      moduleName,
      uiPackName,
      plan,
      buildPriority,
      storeId,
      packageName,
      firebaseProjectId: firebaseAssignment.firebaseProjectId,
      firebaseCredentialsEnvKey:
        firebaseAssignment.firebaseCredentialsEnvKey,
      firebaseProjectBucket: firebaseAssignment.firebaseProjectBucket,
      firebaseProjectSlot: firebaseAssignment.firebaseProjectSlot,
      queued: true,
    },
  });

  try {
    const initialEffectiveDate = new Date().toISOString().slice(0, 10);

    const effectiveDate = await upsertPrivacyPageRecord({
      userId,
      storeId,
      appName,
      merchantEmail,
      effectiveDate: initialEffectiveDate,
    });

    console.log("NDJC startBuild: uploading request files", {
      runId,
      appName,
      moduleName,
      uiPackName,
      plan,
      buildPriority,
      storeId,
      userId,
      merchantEmail,
      effectiveDate,
      packageName,
      firebaseProjectId: firebaseAssignment.firebaseProjectId,
      firebaseCredentialsEnvKey:
        firebaseAssignment.firebaseCredentialsEnvKey,
      firebaseProjectBucket: firebaseAssignment.firebaseProjectBucket,
      firebaseProjectSlot: firebaseAssignment.firebaseProjectSlot,
      queued: true,
    });

    await uploadBuildRequestToRepo(
      {
        ...input,
        appName,
        module: moduleName,
        uiPack: uiPackName,
        plan,
        buildPriority,
        adminName,
        merchantEmail,
        privacyUrl: buildPrivacyPolicyUrl({
          ...input,
          storeId,
        }),
        storeId,
        packageName,
        firebaseProjectId: firebaseAssignment.firebaseProjectId,
        firebaseCredentialsEnvKey:
          firebaseAssignment.firebaseCredentialsEnvKey,
        firebaseProjectBucket: firebaseAssignment.firebaseProjectBucket,
        firebaseProjectSlot: firebaseAssignment.firebaseProjectSlot,
      },
      runId,
      {
        status: "queued",
        stage: "queued",
        message: "Your request has been received and is waiting for an available build slot.",
      },
    );

    await releaseNextQueuedBuild(supabase, runId);
    const currentRecord = await updateBuildRecordByRunId(supabase, runId, {
      statusSource: "local_api",
    });

    return {
      ok: true,
      runId,
      stage: currentRecord.stage,
      message: currentRecord.message,
      storeId: currentRecord.storeId ?? null,
    };
  } catch (error) {
    const failedMessage =
      error instanceof Error
        ? error.message
        : "Failed to trigger packaging workflow.";

await updateBuildRecordByRunId(supabase, runId, {
  status: "failed",
  stage: "failed",
  message: "Failed to trigger packaging workflow.",
  error: failedMessage,
  failedStep: "preparing_request",
  statusSource: "local_api",
}).catch(() => null);

    await insertOperationLogOnce(
      supabase,
      {
        userId,
        buildId: saved.id,
        runId,
        eventName: "build_failed",
        pagePath: "/builder",
        metadata: {
          source: "start_build",
          reason: failedMessage,
        },
      },
      { dedupeSeconds: 30 },
    ).catch(() => null);

    console.error("NDJC startBuild: failed", {
      runId,
      error: failedMessage,
      appName,
      moduleName,
      uiPackName,
      plan,
      storeId,
      userId,
    });

    return {
      ok: false,
      error: failedMessage,
    };
  }
}
