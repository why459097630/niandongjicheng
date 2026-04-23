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
  StepKey,
} from "./types";
import { getOrderByRunId } from "@/lib/stripe/orders";

type GithubWorkflowRun = {
  id?: number;
  name?: string | null;
  display_title?: string | null;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string | null;
};

type GithubWorkflowRunsResponse = {
  workflow_runs?: GithubWorkflowRun[];
};

type GithubWorkflowJobStep = {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
};

type GithubWorkflowJob = {
  steps?: GithubWorkflowJobStep[];
};

type GithubWorkflowJobsResponse = {
  jobs?: GithubWorkflowJob[];
};

type WorkflowResolvedState = {
  workflowRunId: number | null;
  workflowStatus: string | null;
  workflowConclusion: string | null;
  workflowUrl: string | null;
  stage: BuildStage;
  failedStep?: StepKey;
  message: string | null;
};

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

  if (stage === "configuring_build") return "configuring_build";
  if (stage === "queued") return "queued";
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

  if (stage === "configuring_build") return "running";
  if (stage === "queued") return "queued";
  if (stage === "success") return "success";
  if (stage === "failed") return "failed";

  return undefined;
}

function stageToStatus(stage: BuildStage | undefined): BuildStatusValue {
  if (stage === "queued") return "queued";
  if (stage === "success") return "success";
  if (stage === "failed") return "failed";
  return "running";
}

function normalizeFailedStep(value: unknown): StepKey | undefined {
  if (value === "preparing_request") return "preparing_request";
  if (value === "processing_identity") return "processing_identity";
  if (value === "matching_logic_module") return "matching_logic_module";
  if (value === "applying_ui_pack") return "applying_ui_pack";
  if (value === "preparing_services") return "preparing_services";
  if (value === "building_apk") return "building_apk";
  return undefined;
}

function normalizeWorkflowRunId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeWorkflowStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function normalizeWorkflowConclusion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function stageRank(stage: BuildStage | undefined): number {
  if (stage === "queued") return 0;
  if (stage === "configuring_build") return 1;
  if (stage === "preparing_request") return 2;
  if (stage === "processing_identity") return 3;
  if (stage === "matching_logic_module") return 4;
  if (stage === "applying_ui_pack") return 5;
  if (stage === "preparing_services") return 6;
  if (stage === "building_apk") return 7;
  if (stage === "success") return 100;
  if (stage === "failed") return 101;
  return -1;
}

function messageForStage(stage: BuildStage): string {
  if (stage === "configuring_build") {
    return "Payment confirmed. Waiting for build status to sync.";
  }
  if (stage === "queued") {
    return "Your request has been received and is waiting for an available build slot.";
  }
  if (stage === "preparing_request") {
    return "Preparing build request";
  }
  if (stage === "processing_identity") {
    return "Processing app identity";
  }
  if (stage === "matching_logic_module") {
    return "Matching logic module";
  }
  if (stage === "applying_ui_pack") {
    return "Applying UI pack";
  }
  if (stage === "preparing_services") {
    return "Preparing app services and signing";
  }
  if (stage === "building_apk") {
    return "Building and packaging APK";
  }
  if (stage === "success") {
    return "Build completed";
  }
  return "Build failed";
}

function mapWorkflowStepNameToStage(
  rawName: string | null | undefined,
): { stage: BuildStage; failedStep?: StepKey } | null {
  const name = String(rawName || "").trim().toLowerCase();

  if (!name) return null;
  if (name.includes("init build status")) {
    return { stage: "preparing_request", failedStep: "preparing_request" };
  }
  if (name.includes("materialize request")) {
    return { stage: "preparing_request", failedStep: "preparing_request" };
  }
  if (name.includes("processing identity")) {
    return { stage: "processing_identity", failedStep: "processing_identity" };
  }
  if (name.includes("matching logic module")) {
    return { stage: "matching_logic_module", failedStep: "matching_logic_module" };
  }
  if (name.includes("core-templates assembly")) {
    return { stage: "applying_ui_pack", failedStep: "applying_ui_pack" };
  }
  if (name.includes("applying ui pack")) {
    return { stage: "applying_ui_pack", failedStep: "applying_ui_pack" };
  }
  if (name.includes("resolve firebase credentials")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("google cloud auth")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("set up gcloud")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("prepare firebase config")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("install dependencies")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("set up jdk")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("show settings.gradle")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("list projects & tasks")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("preparing services")) {
    return { stage: "preparing_services", failedStep: "preparing_services" };
  }
  if (name.includes("prepare release keystore")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("write signing-info")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("building apk")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("build release")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("rename outputs")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("collect deliverables")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("upload release artifacts")) {
    return { stage: "building_apk", failedStep: "building_apk" };
  }
  if (name.includes("update status - success")) {
    return { stage: "success" };
  }
  if (name.includes("update status - failed")) {
    return { stage: "failed" };
  }

  return null;
}

async function getBuildQueueMeta(
  supabase: SupabaseClient,
  record: InternalBuildRecord | null,
): Promise<{
  queueAheadCount?: number;
  runningCount?: number;
  concurrencyLimit?: number;
}> {
  const rawConcurrencyLimit = (process.env.BUILD_CONCURRENCY_LIMIT || "20").trim();
  const parsedConcurrencyLimit = Number.parseInt(rawConcurrencyLimit, 10);
  const concurrencyLimit =
    Number.isFinite(parsedConcurrencyLimit) && parsedConcurrencyLimit > 0
      ? parsedConcurrencyLimit
      : 20;

  let runningCount: number | undefined = undefined;
  let queueAheadCount: number | undefined = 0;

  const runningResult = await supabase
    .from("builds")
    .select("id", { head: true, count: "exact" })
    .eq("status", "running");

  if (!runningResult.error && typeof runningResult.count === "number") {
    runningCount = runningResult.count;
  }

  const isQueuedRecord =
    record?.status === "queued" || record?.stage === "queued";

  if (isQueuedRecord && record?.createdAt) {
    const currentPriority = record.buildPriority;

    const countQueued = async (
      priority: "admin" | "paid" | "free",
      beforeCreatedAt?: string,
    ): Promise<number> => {
      let query = supabase
        .from("builds")
        .select("id", { head: true, count: "exact" })
        .eq("status", "queued")
        .eq("build_priority", priority);

      if (beforeCreatedAt) {
        query = query.lt("created_at", beforeCreatedAt);
      }

      const result = await query;
      if (result.error || typeof result.count !== "number") {
        return 0;
      }

      return result.count;
    };

    if (currentPriority === "admin") {
      queueAheadCount = await countQueued("admin", record.createdAt);
    } else if (currentPriority === "paid") {
      const adminAhead = await countQueued("admin");
      const paidAhead = await countQueued("paid", record.createdAt);
      queueAheadCount = adminAhead + paidAhead;
    } else {
      const adminAhead = await countQueued("admin");
      const paidAhead = await countQueued("paid");
      const freeAhead = await countQueued("free", record.createdAt);
      queueAheadCount = adminAhead + paidAhead + freeAhead;
    }
  }

  return {
    queueAheadCount,
    runningCount,
    concurrencyLimit,
  };
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

async function safeReadRemoteStatusFile(
  runId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await readRemoteStatusFile(runId);
  } catch (error) {
    console.error("NDJC getBuildStatus: failed to read remote status file", {
      runId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  }
}

async function resolveWorkflowState(
  runId: string,
): Promise<WorkflowResolvedState | null> {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");
  const workflowId = getRequiredEnv("WORKFLOW_ID");

  const runsResponse = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/runs?branch=${encodeURIComponent(branch)}&event=workflow_dispatch&per_page=30`,
    {
      method: "GET",
      token,
    },
  );

  const runsData = (await runsResponse.json()) as GithubWorkflowRunsResponse;

  if (!runsResponse.ok) {
    throw new Error(`Failed to read workflow runs: ${JSON.stringify(runsData)}`);
  }

  const matchedRun =
    (runsData.workflow_runs || []).find((run) => {
      const displayTitle = String(run.display_title || "");
      const name = String(run.name || "");
      return displayTitle.includes(runId) || name.includes(runId);
    }) || null;

  if (!matchedRun || typeof matchedRun.id !== "number") {
    return null;
  }

  const workflowRunId = matchedRun.id;
  const workflowStatus = normalizeWorkflowStatus(matchedRun.status);
  const workflowConclusion = normalizeWorkflowConclusion(matchedRun.conclusion);
  const workflowUrl =
    typeof matchedRun.html_url === "string" ? matchedRun.html_url : null;

  const jobsResponse = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${workflowRunId}/jobs?per_page=100`,
    {
      method: "GET",
      token,
    },
  );

  const jobsData = (await jobsResponse.json()) as GithubWorkflowJobsResponse;

  if (!jobsResponse.ok) {
    throw new Error(`Failed to read workflow jobs: ${JSON.stringify(jobsData)}`);
  }

  let latestMappedStage: BuildStage | undefined = undefined;
  let latestFailedStep: StepKey | undefined = undefined;

  for (const job of jobsData.jobs || []) {
    for (const step of job.steps || []) {
      const mapped = mapWorkflowStepNameToStage(step.name);
      if (!mapped) continue;
      if (step.status !== "completed" && step.status !== "in_progress") continue;
      if (step.conclusion === "skipped") continue;

      latestMappedStage = mapped.stage;
      if (mapped.failedStep) {
        latestFailedStep = mapped.failedStep;
      }
    }
  }

  if (workflowConclusion === "success") {
    return {
      workflowRunId,
      workflowStatus,
      workflowConclusion,
      workflowUrl,
      stage: "success",
      message: "Build completed",
    };
  }

  if (workflowConclusion && workflowConclusion !== "success") {
    return {
      workflowRunId,
      workflowStatus,
      workflowConclusion,
      workflowUrl,
      stage: "failed",
      failedStep: latestFailedStep || "building_apk",
      message: "Packaging workflow failed. Check GitHub Actions logs.",
    };
  }

  if (workflowStatus === "in_progress") {
    const stage = latestMappedStage || "preparing_request";
    return {
      workflowRunId,
      workflowStatus,
      workflowConclusion,
      workflowUrl,
      stage,
      failedStep: latestFailedStep,
      message: messageForStage(stage),
    };
  }

  if (
    workflowStatus === "queued" ||
    workflowStatus === "requested" ||
    workflowStatus === "waiting" ||
    workflowStatus === "pending"
  ) {
    return {
      workflowRunId,
      workflowStatus,
      workflowConclusion,
      workflowUrl,
      stage: "queued",
      message: "Your request has been received and is waiting for an available build slot.",
    };
  }

  return null;
}

async function safeResolveWorkflowState(
  runId: string,
): Promise<WorkflowResolvedState | null> {
  try {
    return await resolveWorkflowState(runId);
  } catch (error) {
    console.error("NDJC getBuildStatus: failed to resolve workflow state", {
      runId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return null;
  }
}

function mapRecordToResponse(
  record: InternalBuildRecord,
  extra?: {
    adminName?: string;
    workflowStatus?: string | null;
    workflowConclusion?: string | null;
    failedStep?: StepKey;
    queueAheadCount?: number;
    runningCount?: number;
    concurrencyLimit?: number;
  },
): BuildStatusResponse {
  return {
    ok: true,
    runId: record.runId,
    stage: record.stage,
    message: record.error || record.message,
    artifactUrl: record.artifactUrl,
    downloadUrl: record.downloadUrl,
    releaseUrl: record.releaseUrl,
    publicApkUrl: record.publicApkUrl,
    error: record.error,
    appName: record.appName,
    adminName: extra?.adminName,
    storeId: record.storeId ?? null,
    moduleName: record.moduleName,
    uiPackName: record.uiPackName,
    plan: record.plan,
    mode: record.mode,
    createdAt: record.createdAt,
    requestPath: record.requestPath ?? null,
    workflowRunId: record.workflowRunId ?? null,
    workflowStatus: extra?.workflowStatus ?? record.workflowStatus ?? null,
    workflowConclusion:
      extra?.workflowConclusion ?? record.workflowConclusion ?? null,
    workflowUrl: record.workflowUrl ?? null,
    failedStep: extra?.failedStep ?? record.failedStep ?? undefined,
    queueAheadCount: extra?.queueAheadCount,
    runningCount: extra?.runningCount,
    concurrencyLimit: extra?.concurrencyLimit,
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
    releaseUrl:
      (typeof remote.releaseUrl === "string" ? remote.releaseUrl : null) ??
      localRecord?.releaseUrl ??
      null,
    publicApkUrl:
      (typeof remote.publicApkUrl === "string" ? remote.publicApkUrl : null) ??
      localRecord?.publicApkUrl ??
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
      normalizeWorkflowRunId(remote.workflowRunId) ??
      localRecord?.workflowRunId ??
      null,
    workflowStatus:
      normalizeWorkflowStatus(remote.workflowStatus) ??
      localRecord?.workflowStatus ??
      null,
    workflowConclusion:
      normalizeWorkflowConclusion(remote.workflowConclusion) ??
      localRecord?.workflowConclusion ??
      null,
    workflowUrl:
      (typeof remote.workflowUrl === "string" ? remote.workflowUrl : null) ??
      localRecord?.workflowUrl ??
      null,
    failedStep: normalizeFailedStep(remote.failedStep),
  };
}

function withPaymentState(
  response: BuildStatusResponse,
  order: {
    status?: string | null;
    compensation_status?: string | null;
    compensation_note?: string | null;
    next_retry_at?: string | null;
    manual_review_required_at?: string | null;
    refunded_at?: string | null;
  } | null,
): BuildStatusResponse {
  const normalizedStatus =
    order?.status === "created" ||
    order?.status === "checkout_created" ||
    order?.status === "paid" ||
    order?.status === "processing" ||
    order?.status === "processed" ||
    order?.status === "failed" ||
    order?.status === "manual_review_required" ||
    order?.status === "refund_pending" ||
    order?.status === "refunded" ||
    order?.status === "canceled"
      ? order.status
      : null;

  const normalizedCompensationStatus =
    order?.compensation_status === "none" ||
    order?.compensation_status === "pending_retry" ||
    order?.compensation_status === "retrying" ||
    order?.compensation_status === "manual_review_required" ||
    order?.compensation_status === "refund_pending" ||
    order?.compensation_status === "refunded"
      ? order.compensation_status
      : null;

  return {
    ...response,
    paymentOrderStatus: normalizedStatus,
    paymentCompensationStatus: normalizedCompensationStatus,
    paymentCompensationNote: order?.compensation_note ?? null,
    paymentNextRetryAt: order?.next_retry_at ?? null,
    paymentManualReviewRequiredAt: order?.manual_review_required_at ?? null,
    paymentRefundedAt: order?.refunded_at ?? null,
  };
}

function getPaidCompensationOverride(
  runId: string,
  order:
    | {
        status?: string | null;
        compensation_status?: string | null;
        compensation_note?: string | null;
        next_retry_at?: string | null;
        manual_review_required_at?: string | null;
        refunded_at?: string | null;
      }
    | null,
  base?: BuildStatusResponse,
): BuildStatusResponse | null {
  if (!order) {
    return null;
  }

  if (
    order.compensation_status === "pending_retry" ||
    order.compensation_status === "retrying"
  ) {
    return withPaymentState(
      {
        ok: true,
        runId,
        stage: "configuring_build",
        message:
          order.compensation_note ||
          "Your paid build hit a temporary issue. We’re retrying it automatically.",
        error: null,
        queueAheadCount: 0,
      },
      order,
    );
  }

  if (
    order.status === "manual_review_required" ||
    order.compensation_status === "manual_review_required"
  ) {
    return withPaymentState(
      {
        ...(base || {
          ok: true,
          runId,
          stage: "failed",
        }),
        stage: "failed",
        message:
          order.compensation_note ||
          "Your paid build is under manual review. No action is required from you right now.",
        error: null,
      },
      order,
    );
  }

  if (
    order.status === "refund_pending" ||
    order.compensation_status === "refund_pending"
  ) {
    return withPaymentState(
      {
        ...(base || {
          ok: true,
          runId,
          stage: "failed",
        }),
        stage: "failed",
        message:
          order.compensation_note ||
          "Refund is being processed for this paid build order.",
        error: null,
      },
      order,
    );
  }

  if (
    order.status === "refunded" ||
    order.compensation_status === "refunded"
  ) {
    return withPaymentState(
      {
        ...(base || {
          ok: true,
          runId,
          stage: "failed",
        }),
        stage: "failed",
        message:
          order.compensation_note ||
          "This paid build order has already been refunded.",
        error: null,
      },
      order,
    );
  }

  return null;
}

function shouldPreferWorkflowState(
  baseStage: BuildStage | undefined,
  baseStatus: BuildStatusValue | undefined,
  workflowState: WorkflowResolvedState | null,
): boolean {
  if (!workflowState) {
    return false;
  }

  if (workflowState.stage === "success" || workflowState.stage === "failed") {
    return true;
  }

  if (baseStage === "success" || baseStage === "failed") {
    return false;
  }

  if (stageRank(workflowState.stage) > stageRank(baseStage)) {
    return true;
  }

  if (
    workflowState.workflowStatus === "in_progress" &&
    (baseStatus === "queued" ||
      baseStage === "queued" ||
      baseStage === "preparing_request")
  ) {
    return true;
  }

  return false;
}

function applyWorkflowState(
  runId: string,
  base: BuildStatusResponse,
  workflowState: WorkflowResolvedState,
): BuildStatusResponse {
  const applied: BuildStatusResponse = {
    ...base,
    stage: workflowState.stage,
    message:
      workflowState.stage === "failed"
        ? base.error || workflowState.message || "Packaging workflow failed. Check GitHub Actions logs."
        : workflowState.message || base.message,
    error:
      workflowState.stage === "failed"
        ? base.error || "Packaging workflow failed. Check GitHub Actions logs."
        : base.error,
    workflowRunId: workflowState.workflowRunId,
    workflowStatus: workflowState.workflowStatus,
    workflowConclusion: workflowState.workflowConclusion,
    workflowUrl: workflowState.workflowUrl,
    failedStep: workflowState.failedStep ?? base.failedStep,
  };

  if (workflowState.stage === "success" && !applied.downloadUrl) {
    applied.downloadUrl = `/api/download-artifact?runId=${runId}`;
  }

  return applied;
}

async function syncResolvedStateToLocal(
  supabase: SupabaseClient,
  localRecord: InternalBuildRecord,
  response: BuildStatusResponse,
  statusSource: "github_status_json" | "manual_fix",
): Promise<InternalBuildRecord> {
  const stage = response.stage || localRecord.stage;
  const status = stageToStatus(stage);
  const synced = await updateBuildRecordByRunId(supabase, localRecord.runId, {
    appName: response.appName || localRecord.appName,
    moduleName: response.moduleName || localRecord.moduleName,
    uiPackName: response.uiPackName || localRecord.uiPackName,
    plan: response.plan || localRecord.plan,
    storeId: response.storeId ?? localRecord.storeId ?? null,
    status,
    stage,
    message: response.message ?? null,
    workflowRunId: response.workflowRunId ?? null,
    workflowUrl: response.workflowUrl ?? null,
    artifactUrl: response.artifactUrl ?? null,
    downloadUrl: response.downloadUrl ?? null,
    releaseUrl: response.releaseUrl ?? null,
    publicApkUrl: response.publicApkUrl ?? null,
    error: response.error ?? null,
    failedStep: response.failedStep ?? null,
    completedAt:
      status === "success" || status === "failed"
        ? localRecord.completedAt ?? new Date().toISOString()
        : undefined,
    statusSource,
    lastSyncedAt: new Date().toISOString(),
  });

  if (status === "failed" && localRecord.userId) {
    await insertOperationLogOnce(
      supabase,
      {
        userId: localRecord.userId,
        buildId: localRecord.id,
        runId: localRecord.runId,
        eventName: "build_failed",
        pagePath: "/generating",
        metadata: {
          source: statusSource,
          reason: response.error ?? response.message ?? "build_failed",
        },
      },
      { dedupeSeconds: 60 },
    ).catch(() => null);
  }

  return synced;
}

const PAID_BUILD_INITIALIZATION_TIMEOUT_MS = 180000;

export async function getBuildStatus(
  supabase: SupabaseClient,
  runId: string,
  options?: { isPaidFlow?: boolean; requestStartTime?: number },
): Promise<BuildStatusResponse> {
  const localRecord = await getBuildRecordByRunId(supabase, runId);
  const remoteStatus = await safeReadRemoteStatusFile(runId);
  const workflowState = await safeResolveWorkflowState(runId);
  const paidOrder = options?.isPaidFlow ? await getOrderByRunId(runId) : null;

  if (remoteStatus) {
    const merged = mergeStatus(runId, localRecord, remoteStatus);
    const remoteStage = normalizeRemoteStage(remoteStatus.stage);
    const remoteNormalizedStatus =
      normalizeRemoteStatus(remoteStatus.status, remoteStage);

    const shouldKeepLocalRunning =
      localRecord?.status === "running" &&
      localRecord.stage !== "success" &&
      localRecord.stage !== "failed" &&
      remoteNormalizedStatus === "queued";

    let baseResponse: BuildStatusResponse = {
      ...merged,
      stage: shouldKeepLocalRunning
        ? localRecord?.stage
        : merged.stage || localRecord?.stage || "queued",
      message: shouldKeepLocalRunning
        ? localRecord?.message ?? merged.message ?? null
        : merged.message ?? null,
    };

    const baseStatus = shouldKeepLocalRunning
      ? "running"
      : remoteNormalizedStatus || stageToStatus(baseResponse.stage);

    if (workflowState && shouldPreferWorkflowState(baseResponse.stage, baseStatus, workflowState)) {
      baseResponse = applyWorkflowState(runId, baseResponse, workflowState);
    }

    if (localRecord) {
      const synced = await syncResolvedStateToLocal(
        supabase,
        localRecord,
        baseResponse,
        workflowState && shouldPreferWorkflowState(merged.stage, remoteNormalizedStatus, workflowState)
          ? "manual_fix"
          : "github_status_json",
      );

      const queueMeta = await getBuildQueueMeta(supabase, synced);

      const response = mapRecordToResponse(synced, {
        adminName: baseResponse.adminName,
        workflowStatus:
          baseResponse.workflowStatus ?? localRecord.workflowStatus ?? null,
        workflowConclusion:
          baseResponse.workflowConclusion ?? localRecord.workflowConclusion ?? null,
        failedStep: baseResponse.failedStep,
        queueAheadCount: queueMeta.queueAheadCount,
        runningCount: queueMeta.runningCount,
        concurrencyLimit: queueMeta.concurrencyLimit,
      });

      const compensationOverride = getPaidCompensationOverride(runId, paidOrder, response);
      return compensationOverride || withPaymentState(response, paidOrder);
    }

    const mergedWithPayment = withPaymentState(baseResponse, paidOrder);
    const mergedOverride = getPaidCompensationOverride(runId, paidOrder, mergedWithPayment);
    return mergedOverride || mergedWithPayment;
  }

  if (workflowState) {
    let baseResponse: BuildStatusResponse;

    if (localRecord) {
      baseResponse = applyWorkflowState(
        runId,
        mapRecordToResponse(localRecord),
        workflowState,
      );

      const synced = await syncResolvedStateToLocal(
        supabase,
        localRecord,
        baseResponse,
        "manual_fix",
      );

      const queueMeta = await getBuildQueueMeta(supabase, synced);

      const response = mapRecordToResponse(synced, {
        adminName: baseResponse.adminName,
        workflowStatus: workflowState.workflowStatus,
        workflowConclusion: workflowState.workflowConclusion,
        failedStep: baseResponse.failedStep,
        queueAheadCount: queueMeta.queueAheadCount,
        runningCount: queueMeta.runningCount,
        concurrencyLimit: queueMeta.concurrencyLimit,
      });

      const compensationOverride = getPaidCompensationOverride(runId, paidOrder, response);
      return compensationOverride || withPaymentState(response, paidOrder);
    }

    baseResponse = applyWorkflowState(
      runId,
      {
        ok: true,
        runId,
        stage: workflowState.stage,
        message: workflowState.message,
        workflowRunId: workflowState.workflowRunId,
        workflowStatus: workflowState.workflowStatus,
        workflowConclusion: workflowState.workflowConclusion,
        workflowUrl: workflowState.workflowUrl,
        failedStep: workflowState.failedStep,
      },
      workflowState,
    );

    const workflowOnlyOverride = getPaidCompensationOverride(runId, paidOrder, baseResponse);
    return workflowOnlyOverride || withPaymentState(baseResponse, paidOrder);
  }

  if (!localRecord) {
    const isPaidFlow = options?.isPaidFlow === true;
    const requestStartTime = options?.requestStartTime || Date.now();
    const now = Date.now();
    const elapsed = now - requestStartTime;

    if (isPaidFlow) {
      const compensationOverride = getPaidCompensationOverride(runId, paidOrder);

      if (compensationOverride) {
        return compensationOverride;
      }

      if (paidOrder?.status === "failed") {
        return withPaymentState(
          {
            ok: false,
            error: paidOrder.error || "Paid build failed.",
          },
          paidOrder,
        );
      }

      if (
        paidOrder &&
        (paidOrder.status === "created" ||
          paidOrder.status === "checkout_created" ||
          paidOrder.status === "paid" ||
          paidOrder.status === "processing" ||
          paidOrder.status === "processed")
      ) {
        return withPaymentState(
          {
            ok: true,
            runId,
            stage: "configuring_build",
            message:
              paidOrder.status === "processed"
                ? "Payment confirmed. Waiting for build status to sync."
                : "Payment received. Securely preparing your build.",
            queueAheadCount: 0,
          },
          paidOrder,
        );
      }

      if (elapsed < PAID_BUILD_INITIALIZATION_TIMEOUT_MS) {
        return {
          ok: true,
          runId,
          stage: "configuring_build",
          message: "Waiting for secure payment confirmation.",
          queueAheadCount: 0,
        };
      }
    }

    return {
      ok: false,
      error: "Build record not found.",
    };
  }

  const queueMeta = await getBuildQueueMeta(supabase, localRecord);
  const localResponse = mapRecordToResponse(localRecord, {
    queueAheadCount: queueMeta.queueAheadCount,
    runningCount: queueMeta.runningCount,
    concurrencyLimit: queueMeta.concurrencyLimit,
  });

  const compensationOverride = getPaidCompensationOverride(runId, paidOrder, localResponse);
  return compensationOverride || withPaymentState(localResponse, paidOrder);
}