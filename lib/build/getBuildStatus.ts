import { getBuildRecord, upsertBuildRecord } from "./storage";
import { BuildStatusResponse, InternalBuildRecord } from "./types";

const STAGE_TIMELINE = [
  {
    maxElapsedMs: 3_000,
    stage: "preparing_request" as const,
    status: "running" as const,
    message: "Preparing build request.",
  },
  {
    maxElapsedMs: 7_000,
    stage: "processing_identity" as const,
    status: "running" as const,
    message: "Processing app identity and package metadata.",
  },
  {
    maxElapsedMs: 12_000,
    stage: "matching_module" as const,
    status: "running" as const,
    message: "Matching logic module to your selected app type.",
  },
  {
    maxElapsedMs: 17_000,
    stage: "applying_ui" as const,
    status: "running" as const,
    message: "Applying selected UI pack to the generated structure.",
  },
  {
    maxElapsedMs: 23_000,
    stage: "preparing_services" as const,
    status: "running" as const,
    message: "Preparing app services, signing config, and packaging assets.",
  },
  {
    maxElapsedMs: 30_000,
    stage: "building_apk" as const,
    status: "running" as const,
    message: "Building and packaging APK.",
  },
] as const;

function evolveRecord(record: InternalBuildRecord): InternalBuildRecord {
  if (record.status === "success" || record.status === "failed") {
    return record;
  }

  const createdAtMs = new Date(record.createdAt).getTime();
  const nowMs = Date.now();
  const elapsedMs = Math.max(0, nowMs - createdAtMs);

  const matchedStage = STAGE_TIMELINE.find((item) => elapsedMs <= item.maxElapsedMs);
  const updatedAt = new Date().toISOString();

  if (matchedStage) {
    const nextRecord: InternalBuildRecord = {
      ...record,
      status: matchedStage.status,
      stage: matchedStage.stage,
      message: matchedStage.message,
      updatedAt,
    };

    upsertBuildRecord(nextRecord);
    return nextRecord;
  }

  const successRecord: InternalBuildRecord = {
    ...record,
    status: "success",
    stage: "success",
    message: "Build completed successfully. APK is ready for download.",
    updatedAt,
  };

  upsertBuildRecord(successRecord);
  return successRecord;
}

export function getBuildStatus(runId: string): BuildStatusResponse {
  const record = getBuildRecord(runId);

  if (!record) {
    return {
      ok: false,
      error: "Build record not found.",
    };
  }

  const current = evolveRecord(record);

  return {
    ok: true,
    runId: current.runId,
    stage: current.stage,
    message: current.error || current.message,
    artifactUrl: current.artifactUrl,
    downloadUrl: current.downloadUrl,
    error: current.error || undefined,
    appName: current.appName,
    moduleName: current.moduleName,
    uiPackName: current.uiPackName,
    plan: current.plan,
    mode: current.mode,
    createdAt: current.createdAt,
    adminName: current.adminName,
    adminPassword: current.adminPassword,
  };
}