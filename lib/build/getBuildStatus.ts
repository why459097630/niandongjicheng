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
  PaymentCompensationStatus,
  PaymentOrderStatus,
  StepKey,
} from "./types";
import { getOrderByRunId } from "@/lib/stripe/orders";

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
    const queueAheadResult = await supabase
      .from("builds")
      .select("id", { head: true, count: "exact" })
      .eq("status", "queued")
      .lt("created_at", record.createdAt);

    if (!queueAheadResult.error && typeof queueAheadResult.count === "number") {
      queueAheadCount = queueAheadResult.count;
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
    failedStep: normalizeFailedStep(remote.failedStep),
  };
}

function withPaymentState(
  response: BuildStatusResponse,
  order: {
    status?: PaymentOrderStatus | null;
    compensation_status?: PaymentCompensationStatus | null;
    compensation_note?: string | null;
    next_retry_at?: string | null;
    manual_review_required_at?: string | null;
    refunded_at?: string | null;
  } | null,
): BuildStatusResponse {
  return {
    ...response,
    paymentOrderStatus: order?.status ?? null,
    paymentCompensationStatus: order?.compensation_status ?? null,
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
        status?: PaymentOrderStatus | null;
        compensation_status?: PaymentCompensationStatus | null;
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

const PAID_BUILD_INITIALIZATION_TIMEOUT_MS = 180000;

export async function getBuildStatus(
  supabase: SupabaseClient,
  runId: string,
  options?: { isPaidFlow?: boolean; requestStartTime?: number },
): Promise<BuildStatusResponse> {
  const localRecord = await getBuildRecordByRunId(supabase, runId);
  const remoteStatus = await readRemoteStatusFile(runId);
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

    const stage = shouldKeepLocalRunning
      ? localRecord.stage
      : merged.stage || localRecord?.stage || "queued";

    const status = shouldKeepLocalRunning
      ? "running"
      : remoteNormalizedStatus || stageToStatus(stage);

    const message = shouldKeepLocalRunning
      ? localRecord?.message ?? merged.message ?? null
      : merged.message ?? null;

    if (localRecord) {
const synced = await updateBuildRecordByRunId(supabase, runId, {
  appName: merged.appName,
  moduleName: merged.moduleName,
  uiPackName: merged.uiPackName,
  plan: merged.plan,
  storeId: merged.storeId ?? null,
  status,
  stage,
  message,
  workflowRunId: merged.workflowRunId ?? null,
  workflowUrl: merged.workflowUrl ?? null,
  artifactUrl: merged.artifactUrl ?? null,
  downloadUrl: merged.downloadUrl ?? null,
  error: merged.error ?? null,
  failedStep: merged.failedStep ?? null,
  completedAt: status === "success" ? (localRecord.completedAt ?? new Date().toISOString()) : undefined,
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

      const queueMeta = await getBuildQueueMeta(supabase, synced);

      const baseResponse = mapRecordToResponse(synced, {
        adminName: merged.adminName,
        workflowStatus: merged.workflowStatus ?? null,
        workflowConclusion: merged.workflowConclusion ?? null,
        failedStep: merged.failedStep,
        queueAheadCount: queueMeta.queueAheadCount,
        runningCount: queueMeta.runningCount,
        concurrencyLimit: queueMeta.concurrencyLimit,
      });

      const compensationOverride = getPaidCompensationOverride(runId, paidOrder, baseResponse);

      return compensationOverride || withPaymentState(baseResponse, paidOrder);
    }

    const mergedWithPayment = withPaymentState(merged, paidOrder);
    const mergedOverride = getPaidCompensationOverride(runId, paidOrder, mergedWithPayment);

    return mergedOverride || mergedWithPayment;
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

    return {
      ok: false,
      error: "Build setup did not complete in time.",
    };
  }

  return {
    ok: false,
    error: "Build record not found.",
  };
}

  const queueMeta = await getBuildQueueMeta(supabase, localRecord);

  const baseResponse = mapRecordToResponse(localRecord, {
    queueAheadCount: queueMeta.queueAheadCount,
    runningCount: queueMeta.runningCount,
    concurrencyLimit: queueMeta.concurrencyLimit,
  });

  const compensationOverride = getPaidCompensationOverride(runId, paidOrder, baseResponse);

  return compensationOverride || withPaymentState(baseResponse, paidOrder);
}
