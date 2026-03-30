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

export function startBuild(input: BuildRequest): StartBuildResponse {
  const appName = input.appName?.trim() || "Untitled App";
  const moduleName = input.module?.trim() || "feature-showcase";
  const uiPackName = input.uiPack?.trim() || "ui-pack-showcase-greenpink";
  const plan = normalizePlan(input.plan || "pro");
  const adminName = input.adminName?.trim() || "";
  const adminPassword = input.adminPassword || "";
  const runId = createRunId();
  const now = new Date().toISOString();

  const record: InternalBuildRecord = {
    runId,
    appName,
    moduleName,
    uiPackName,
    plan,
    mode: getModeFromPlan(plan),
    iconUrl: input.iconUrl || null,
    adminName,
    adminPassword,
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

  return {
    ok: true,
    runId,
    stage: saved.stage,
    message: saved.message,
  };
}