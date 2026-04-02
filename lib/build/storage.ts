import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BuildMode,
  BuildStage,
  BuildStatusSource,
  BuildStatusValue,
  InternalBuildRecord,
  UserOperationEventName,
} from "./types";

type BuildRow = {
  id: string;
  user_id: string;
  run_id: string;
  app_name: string;
  module_name: string;
  ui_pack_name: string;
  plan: string;
  store_id: string | null;
  status: BuildStatusValue;
  stage: string;
  message: string | null;
  workflow_run_id: number | null;
  workflow_url: string | null;
  artifact_url: string | null;
  download_url: string | null;
  error: string | null;
  status_source: BuildStatusSource;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type NewBuildRecordInput = {
  userId: string;
  runId: string;
  appName: string;
  moduleName: string;
  uiPackName: string;
  plan: string;
  storeId?: string | null;
  status: BuildStatusValue;
  stage: BuildStage;
  message: string;
  workflowRunId?: number | null;
  workflowUrl?: string | null;
  artifactUrl?: string | null;
  downloadUrl?: string | null;
  error?: string | null;
  statusSource?: BuildStatusSource;
  lastSyncedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type UpdateBuildRecordInput = {
  appName?: string;
  moduleName?: string;
  uiPackName?: string;
  plan?: string;
  storeId?: string | null;
  status?: BuildStatusValue;
  stage?: BuildStage;
  message?: string | null;
  workflowRunId?: number | null;
  workflowUrl?: string | null;
  artifactUrl?: string | null;
  downloadUrl?: string | null;
  error?: string | null;
  statusSource?: BuildStatusSource;
  lastSyncedAt?: string | null;
  updatedAt?: string;
};

type InsertOperationLogInput = {
  userId: string;
  buildId?: string | null;
  runId?: string | null;
  eventName: UserOperationEventName;
  pagePath?: string | null;
  metadata?: Record<string, unknown>;
};

type UpsertCurrentUserProfileInput = {
  displayName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
};

function normalizePlan(plan: string): string {
  const value = plan.trim().toLowerCase();
  if (!value) {
    return "pro";
  }

  return value;
}

function planToMode(plan: string): BuildMode {
  return normalizePlan(plan) === "free" ? "Free Trial" : "Paid Purchase";
}

function normalizeStage(
  status: BuildStatusValue,
  stage: string | null | undefined,
): BuildStage {
  if (stage === "preparing_request") return "preparing_request";
  if (stage === "processing_identity") return "processing_identity";
  if (stage === "matching_logic_module") return "matching_logic_module";
  if (stage === "applying_ui_pack") return "applying_ui_pack";
  if (stage === "preparing_services") return "preparing_services";
  if (stage === "building_apk") return "building_apk";
  if (stage === "success") return "success";
  if (stage === "failed") return "failed";

  if (status === "success") return "success";
  if (status === "failed") return "failed";

  return "preparing_request";
}

function mapBuildRow(row: BuildRow): InternalBuildRecord {
  return {
    id: row.id,
    runId: row.run_id,
    appName: row.app_name,
    moduleName: row.module_name,
    uiPackName: row.ui_pack_name,
    plan: row.plan,
    mode: planToMode(row.plan),
    storeId: row.store_id,
    userId: row.user_id,
    requestPath: `requests/${row.run_id}/status.json`,
    workflowRunId: row.workflow_run_id,
    workflowStatus: null,
    workflowConclusion: null,
    workflowUrl: row.workflow_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSyncedAt: row.last_synced_at,
    statusSource: row.status_source,
    status: row.status,
    stage: normalizeStage(row.status, row.stage),
    message: row.message || "",
    artifactUrl: row.artifact_url,
    downloadUrl: row.download_url,
    error: row.error,
  };
}

function buildInsertPayload(input: NewBuildRecordInput) {
  const now = new Date().toISOString();

  return {
    user_id: input.userId,
    run_id: input.runId,
    app_name: input.appName,
    module_name: input.moduleName,
    ui_pack_name: input.uiPackName,
    plan: normalizePlan(input.plan),
    store_id: input.storeId ?? null,
    status: input.status,
    stage: input.stage,
    message: input.message,
    workflow_run_id: input.workflowRunId ?? null,
    workflow_url: input.workflowUrl ?? null,
    artifact_url: input.artifactUrl ?? null,
    download_url: input.downloadUrl ?? null,
    error: input.error ?? null,
    status_source: input.statusSource ?? "local_api",
    last_synced_at: input.lastSyncedAt ?? null,
    created_at: input.createdAt ?? now,
    updated_at: input.updatedAt ?? now,
  };
}

function buildUpdatePayload(input: UpdateBuildRecordInput) {
  const payload: Record<string, unknown> = {
    updated_at: input.updatedAt ?? new Date().toISOString(),
  };

  if (typeof input.appName === "string") payload.app_name = input.appName;
  if (typeof input.moduleName === "string") payload.module_name = input.moduleName;
  if (typeof input.uiPackName === "string") payload.ui_pack_name = input.uiPackName;
  if (typeof input.plan === "string") payload.plan = normalizePlan(input.plan);
  if (input.storeId !== undefined) payload.store_id = input.storeId;
  if (typeof input.status === "string") payload.status = input.status;
  if (typeof input.stage === "string") payload.stage = input.stage;
  if (input.message !== undefined) payload.message = input.message;
  if (input.workflowRunId !== undefined) payload.workflow_run_id = input.workflowRunId;
  if (input.workflowUrl !== undefined) payload.workflow_url = input.workflowUrl;
  if (input.artifactUrl !== undefined) payload.artifact_url = input.artifactUrl;
  if (input.downloadUrl !== undefined) payload.download_url = input.downloadUrl;
  if (input.error !== undefined) payload.error = input.error;
  if (input.statusSource !== undefined) payload.status_source = input.statusSource;
  if (input.lastSyncedAt !== undefined) payload.last_synced_at = input.lastSyncedAt;

  return payload;
}

export async function insertBuildRecord(
  supabase: SupabaseClient,
  input: NewBuildRecordInput,
): Promise<InternalBuildRecord> {
  const { data, error } = await supabase
    .from("builds")
    .insert(buildInsertPayload(input))
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to insert build record.");
  }

  return mapBuildRow(data as BuildRow);
}

export async function updateBuildRecordByRunId(
  supabase: SupabaseClient,
  runId: string,
  input: UpdateBuildRecordInput,
): Promise<InternalBuildRecord> {
  const { data, error } = await supabase
    .from("builds")
    .update(buildUpdatePayload(input))
    .eq("run_id", runId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update build record.");
  }

  return mapBuildRow(data as BuildRow);
}

export async function getBuildRecordByRunId(
  supabase: SupabaseClient,
  runId: string,
): Promise<InternalBuildRecord | null> {
  const { data, error } = await supabase
    .from("builds")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapBuildRow(data as BuildRow);
}

export async function listBuildRecordsByUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<InternalBuildRecord[]> {
  const { data, error } = await supabase
    .from("builds")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row) => mapBuildRow(row as BuildRow));
}

export async function insertOperationLog(
  supabase: SupabaseClient,
  input: InsertOperationLogInput,
): Promise<void> {
  const { error } = await supabase.from("user_operation_logs").insert({
    user_id: input.userId,
    build_id: input.buildId ?? null,
    run_id: input.runId ?? null,
    event_name: input.eventName,
    page_path: input.pagePath ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function upsertCurrentUserProfile(
  supabase: SupabaseClient,
  input: UpsertCurrentUserProfileInput,
): Promise<void> {
  const { error } = await supabase.rpc("upsert_profile", {
    p_display_name: input.displayName ?? null,
    p_avatar_url: input.avatarUrl ?? null,
    p_provider: input.provider ?? "google",
  });

  if (error) {
    throw new Error(error.message);
  }
}
