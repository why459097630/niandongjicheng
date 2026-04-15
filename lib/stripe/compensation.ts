import Stripe from "stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { provisionStore } from "@/lib/build/provisionStore";
import { startBuild } from "@/lib/build/startBuild";
import { getBuildRecordByRunId, insertOperationLog } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";
import {
  claimOrderForProcessing,
  clearOrderPayload,
  completeOrder,
  getOrderById,
  readGenerateOrderPayload,
  readRenewOrderPayload,
  type StripeOrderKind,
  type StripeOrderRecord,
} from "@/lib/stripe/orders";

export type OrderProcessMode = "initial" | "auto_retry" | "manual_retry";

export type OrderProcessResult = {
  ok: boolean;
  orderId: string;
  status:
    | "processed"
    | "scheduled_retry"
    | "manual_review_required"
    | "skipped"
    | "refunded";
  error?: string | null;
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getServiceSupabase() {
  const supabaseUrl = getRequiredEnv("WEB_SUPABASE_URL");
  const supabaseSecretKey = getRequiredEnv("WEB_SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getStripeClient() {
  return new Stripe(getRequiredEnv("STRIPE_SECRET_KEY"));
}

function getAppCloudSupabase() {
  const appCloudUrl = getRequiredEnv("APP_CLOUD_SUPABASE_URL");
  const appCloudSecretKey = getRequiredEnv("APP_CLOUD_SUPABASE_SECRET_KEY");

  return createSupabaseClient(appCloudUrl, appCloudSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 1000);
  }

  return "Unknown payment execution error.";
}

function addDaysFromBase(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function getRenewDays(renewId: string): number {
  const map: Record<string, number> = {
    "30d": 30,
    "90d": 90,
    "180d": 180,
  };

  const days = map[renewId];

  if (!days) {
    throw new Error("Invalid renewId.");
  }

  return days;
}

function getAutoRetryLimit(orderKind: StripeOrderKind): number {
  if (orderKind === "generate_app") {
    const raw = Number(process.env.STRIPE_AUTO_RETRY_MAX_GENERATE || 2);
    return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 2;
  }

  const raw = Number(process.env.STRIPE_AUTO_RETRY_MAX_RENEW || 3);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 3;
}

function getRetryDelayMinutes(
  orderKind: StripeOrderKind,
  nextRetryCount: number,
): number {
  if (orderKind === "generate_app") {
    if (nextRetryCount <= 1) return 0.5;
    if (nextRetryCount <= 2) return 1.5;
    return 1.5;
  }

  if (nextRetryCount <= 1) return 0.25;
  if (nextRetryCount <= 2) return 0.5;
  return 1;
}

async function patchOrder(
  orderId: string,
  patch: Record<string, unknown>,
): Promise<StripeOrderRecord> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .update(patch)
    .eq("id", orderId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to patch web_stripe_orders.");
  }

  return data as StripeOrderRecord;
}

async function claimOrderForAutoRetry(
  order: StripeOrderRecord,
): Promise<StripeOrderRecord | null> {
  const now = Date.now();
  const nextRetryAtMs = order.next_retry_at
    ? new Date(order.next_retry_at).getTime()
    : 0;

  if (order.status !== "failed") {
    return null;
  }

  if ((order.compensation_status || "") !== "pending_retry") {
    return null;
  }

  if (nextRetryAtMs && Number.isFinite(nextRetryAtMs) && nextRetryAtMs > now) {
    return null;
  }

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .update({
      status: "processing",
      compensation_status: "retrying",
      compensation_note: "Automatic retry is running.",
      last_retry_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", order.id)
    .eq("status", "failed")
    .eq("compensation_status", "pending_retry")
    .is("processed_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

async function claimOrderForManualRetry(
  order: StripeOrderRecord,
): Promise<StripeOrderRecord | null> {
  if (
    order.status !== "failed" &&
    order.status !== "manual_review_required"
  ) {
    return null;
  }

  const nextManualRetryCount = Number(order.manual_retry_count || 0) + 1;
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .update({
      status: "processing",
      compensation_status: "retrying",
      compensation_note: "Manual retry is running.",
      manual_retry_count: nextManualRetryCount,
      last_retry_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", order.id)
    .in("status", ["failed", "manual_review_required"])
    .is("processed_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

async function markRenewalApplied(orderId: string) {
  await patchOrder(orderId, {
    renewal_applied_at: new Date().toISOString(),
    compensation_note: null,
  });
}

async function markBuildStarted(orderId: string) {
  await patchOrder(orderId, {
    build_started_at: new Date().toISOString(),
    compensation_note: null,
  });
}

async function sendAdminAlert(order: StripeOrderRecord, reason: string) {
  const supabase = getServiceSupabase();

  await insertOperationLog(supabase, {
    userId: order.user_id,
    runId: order.run_id,
    eventName: "payment_manual_review_required",
    pagePath: "/api/stripe/compensate",
    metadata: {
      orderId: order.id,
      orderKind: order.order_kind,
      runId: order.run_id,
      storeId: order.store_id,
      renewId: order.renew_id,
      status: order.status,
      compensationStatus: order.compensation_status,
      reason,
    },
  }).catch(() => null);

  const adminAlertWebhookUrl = (process.env.ADMIN_ALERT_WEBHOOK_URL || "").trim();

  if (adminAlertWebhookUrl) {
    await fetch(adminAlertWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "NDJC payment order requires manual review.",
        orderId: order.id,
        orderKind: order.order_kind,
        runId: order.run_id,
        storeId: order.store_id,
        renewId: order.renew_id,
        reason,
      }),
      cache: "no-store",
    }).catch(() => null);
  }

  await patchOrder(order.id, {
    admin_notified_at: new Date().toISOString(),
  });
}

async function scheduleRetryOrManualReview(
  order: StripeOrderRecord,
  errorMessage: string,
  mode: OrderProcessMode,
): Promise<OrderProcessResult> {
  const nowIso = new Date().toISOString();

  if (mode === "manual_retry") {
    const updated = await patchOrder(order.id, {
      status: "manual_review_required",
      failed_at: nowIso,
      error: errorMessage,
      compensation_status: "manual_review_required",
      compensation_note: "Manual retry failed. Please refund or inspect manually.",
      next_retry_at: null,
      manual_review_required_at: nowIso,
    });

    if (!updated.admin_notified_at) {
      await sendAdminAlert(updated, errorMessage);
    }

    return {
      ok: false,
      orderId: order.id,
      status: "manual_review_required",
      error: errorMessage,
    };
  }

  const currentRetryCount = Number(order.retry_count || 0);
  const nextRetryCount = currentRetryCount + 1;
  const maxRetry = getAutoRetryLimit(order.order_kind);

  if (nextRetryCount <= maxRetry) {
    const nextRetryAt = new Date(
      Date.now() + getRetryDelayMinutes(order.order_kind, nextRetryCount) * 60 * 1000,
    ).toISOString();

    await patchOrder(order.id, {
      status: "failed",
      failed_at: nowIso,
      error: errorMessage,
      retry_count: nextRetryCount,
      next_retry_at: nextRetryAt,
      last_retry_at: nowIso,
      compensation_status: "pending_retry",
      compensation_note: `Automatic retry ${nextRetryCount}/${maxRetry} has been scheduled.`,
    });

    const supabase = getServiceSupabase();

    await insertOperationLog(supabase, {
      userId: order.user_id,
      runId: order.run_id,
      eventName: "payment_auto_retry_scheduled",
      pagePath: "/api/stripe/compensate",
      metadata: {
        orderId: order.id,
        orderKind: order.order_kind,
        runId: order.run_id,
        storeId: order.store_id,
        renewId: order.renew_id,
        retryCount: nextRetryCount,
        maxRetry,
        nextRetryAt,
        error: errorMessage,
      },
    }).catch(() => null);

    return {
      ok: false,
      orderId: order.id,
      status: "scheduled_retry",
      error: errorMessage,
    };
  }

  const updated = await patchOrder(order.id, {
    status: "manual_review_required",
    failed_at: nowIso,
    error: errorMessage,
    retry_count: nextRetryCount,
    next_retry_at: null,
    last_retry_at: nowIso,
    compensation_status: "manual_review_required",
    compensation_note: "Automatic retries exhausted. Manual review required.",
    manual_review_required_at: nowIso,
  });

  if (!updated.admin_notified_at) {
    await sendAdminAlert(updated, errorMessage);
  }

  return {
    ok: false,
    orderId: order.id,
    status: "manual_review_required",
    error: errorMessage,
  };
}

async function applyRenewalToStore(order: StripeOrderRecord) {
  const renewPayload = readRenewOrderPayload(order);
  const renewDays = getRenewDays(renewPayload.renewId);
  const appCloudSupabase = getAppCloudSupabase();

  const storeIdForTest = String(renewPayload.storeId || "").trim();

  if (storeIdForTest === "store_showcase_paid_000007") {
    throw new Error("NDJC_TEST_FORCE_RENEW_FAIL");
  }

  const { data: store, error: storeError } = await appCloudSupabase
    .from("stores")
    .select("store_id, service_end_at")
    .eq("store_id", renewPayload.storeId)
    .maybeSingle();

  if (storeError) {
    throw new Error(storeError.message);
  }

  if (!store) {
    throw new Error("Store not found in app cloud.");
  }

  const now = new Date();
  const currentEnd = store.service_end_at ? new Date(store.service_end_at) : null;

  const baseDate =
    currentEnd && !Number.isNaN(currentEnd.getTime()) && currentEnd.getTime() > now.getTime()
      ? currentEnd
      : now;

  const newServiceEndAt = addDaysFromBase(baseDate, renewDays);
  const newDeleteAt = addDaysFromBase(newServiceEndAt, 60);

  const { error: updateError } = await appCloudSupabase
    .from("stores")
    .update({
      service_status: "active",
      is_write_allowed: true,
      service_end_at: newServiceEndAt.toISOString(),
      delete_at: newDeleteAt.toISOString(),
    })
    .eq("store_id", renewPayload.storeId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function executeGenerateOrder(order: StripeOrderRecord): Promise<void> {
  if (!order.run_id) {
    throw new Error("Generate order runId is missing.");
  }

  const supabase = getServiceSupabase();
  const existingRecord = await getBuildRecordByRunId(supabase, order.run_id);

  if (
    existingRecord &&
    (existingRecord.status === "queued" ||
      existingRecord.status === "running" ||
      existingRecord.status === "success")
  ) {
    await markBuildStarted(order.id);
    await clearOrderPayload(order.id);
    await completeOrder(order.id);
    return;
  }

  const buildPayload = readGenerateOrderPayload(order);

  if (buildPayload.plan !== "pro") {
    throw new Error("Paid generate order plan must be pro.");
  }

  const appNameForTest = String(buildPayload.appName || "").trim().toLowerCase();

  if (appNameForTest.startsWith("fail_test")) {
    throw new Error("NDJC_TEST_FORCE_FAIL");
  }

  let storeId = existingRecord?.storeId || "";

  if (!storeId) {
    const provisionResult = await provisionStore({
      module: buildPayload.module,
      plan: buildPayload.plan,
      adminName: buildPayload.adminName,
      adminPassword: buildPayload.adminPassword,
    });

    if (!provisionResult.ok || !provisionResult.storeId) {
      throw new Error(
        `Failed to provision store after payment. Result: ${JSON.stringify(provisionResult)}`,
      );
    }

    storeId = provisionResult.storeId;
  }

  const buildInput: BuildRequest = {
    appName: buildPayload.appName,
    module: buildPayload.module,
    uiPack: buildPayload.uiPack,
    plan: buildPayload.plan,
    adminName: buildPayload.adminName,
    iconDataUrl: buildPayload.iconDataUrl,
    runId: order.run_id,
    userId: order.user_id,
    storeId,
  };

  const buildResult = await startBuild(supabase, buildInput);

  if (!buildResult.ok) {
    throw new Error(buildResult.error || "Failed to start paid build.");
  }

  await markBuildStarted(order.id);
  await clearOrderPayload(order.id);
  await completeOrder(order.id);
}

async function executeRenewOrder(order: StripeOrderRecord): Promise<void> {
  if (order.renewal_applied_at) {
    await clearOrderPayload(order.id);
    await completeOrder(order.id);
    return;
  }

  await applyRenewalToStore(order);
  await markRenewalApplied(order.id);
  await clearOrderPayload(order.id);
  await completeOrder(order.id);
}

export async function processStripeOrderById(
  orderId: string,
  mode: OrderProcessMode,
): Promise<OrderProcessResult> {
  const baseOrder = await getOrderById(orderId);

  if (!baseOrder) {
    return {
      ok: false,
      orderId,
      status: "skipped",
      error: "Order not found.",
    };
  }

  if (baseOrder.status === "processed") {
    return {
      ok: true,
      orderId: baseOrder.id,
      status: "processed",
    };
  }

  if (baseOrder.status === "refunded" || baseOrder.status === "refund_pending") {
    return {
      ok: true,
      orderId: baseOrder.id,
      status: "skipped",
    };
  }

  let claimedOrder: StripeOrderRecord | null = null;

  if (mode === "initial") {
    claimedOrder = await claimOrderForProcessing(baseOrder.id);
  } else if (mode === "auto_retry") {
    claimedOrder = await claimOrderForAutoRetry(baseOrder);
  } else {
    claimedOrder = await claimOrderForManualRetry(baseOrder);
    if (claimedOrder) {
      const supabase = getServiceSupabase();

      await insertOperationLog(supabase, {
        userId: claimedOrder.user_id,
        runId: claimedOrder.run_id,
        eventName: "payment_manual_retry_started",
        pagePath: "/api/admin/orders/retry",
        metadata: {
          orderId: claimedOrder.id,
          orderKind: claimedOrder.order_kind,
          runId: claimedOrder.run_id,
          storeId: claimedOrder.store_id,
          renewId: claimedOrder.renew_id,
          manualRetryCount: claimedOrder.manual_retry_count,
        },
      }).catch(() => null);
    }
  }

  if (!claimedOrder) {
    return {
      ok: true,
      orderId: baseOrder.id,
      status: "skipped",
    };
  }

  try {
    if (claimedOrder.order_kind === "renew_cloud") {
      await executeRenewOrder(claimedOrder);

      return {
        ok: true,
        orderId: claimedOrder.id,
        status: "processed",
      };
    }

    if (claimedOrder.order_kind === "generate_app") {
      await executeGenerateOrder(claimedOrder);

      return {
        ok: true,
        orderId: claimedOrder.id,
        status: "processed",
      };
    }

    throw new Error("Unsupported Stripe order kind.");
  } catch (error) {
    return scheduleRetryOrManualReview(
      claimedOrder,
      getSafeErrorMessage(error),
      mode,
    );
  }
}

export async function listOrdersNeedingAutoCompensation(
  limit = 20,
): Promise<StripeOrderRecord[]> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .select("*")
    .eq("status", "failed")
    .eq("compensation_status", "pending_retry")
    .order("next_retry_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data || []) as StripeOrderRecord[]).filter((item) => {
    if (!item.next_retry_at) return true;
    const ms = new Date(item.next_retry_at).getTime();
    return !Number.isNaN(ms) && ms <= Date.now();
  });
}

export async function runAutoCompensation(limit = 20) {
  const dueOrders = await listOrdersNeedingAutoCompensation(limit);
  const results: OrderProcessResult[] = [];

  for (const order of dueOrders) {
    const result = await processStripeOrderById(order.id, "auto_retry");
    results.push(result);
  }

  return {
    ok: true,
    picked: dueOrders.length,
    results,
  };
}

export async function refundStripeOrder(
  orderId: string,
  reason: string,
): Promise<OrderProcessResult & { refundId?: string | null }> {
  const order = await getOrderById(orderId);

  if (!order) {
    return {
      ok: false,
      orderId,
      status: "skipped",
      error: "Order not found.",
      refundId: null,
    };
  }

  if (order.status === "refunded") {
    return {
      ok: true,
      orderId: order.id,
      status: "refunded",
      refundId: order.stripe_refund_id || null,
    };
  }

  if (order.status === "processed") {
    return {
      ok: false,
      orderId: order.id,
      status: "skipped",
      error: "Processed orders cannot be refunded automatically.",
      refundId: null,
    };
  }

  if (!order.stripe_payment_intent_id) {
    return {
      ok: false,
      orderId: order.id,
      status: "skipped",
      error: "stripe_payment_intent_id is missing.",
      refundId: null,
    };
  }

  if (order.renewal_applied_at) {
    return {
      ok: false,
      orderId: order.id,
      status: "skipped",
      error: "Renewal has already been applied. Refund is blocked.",
      refundId: null,
    };
  }

  if (order.order_kind === "generate_app" && order.run_id) {
    const supabase = getServiceSupabase();
    const existingRecord = await getBuildRecordByRunId(supabase, order.run_id);

    if (
      existingRecord &&
      (existingRecord.status === "queued" ||
        existingRecord.status === "running" ||
        existingRecord.status === "success")
    ) {
      return {
        ok: false,
        orderId: order.id,
        status: "skipped",
        error: "Build has already started or completed. Refund is blocked.",
        refundId: null,
      };
    }
  }

  await patchOrder(order.id, {
    status: "refund_pending",
    compensation_status: "refund_pending",
    compensation_note: reason || "Refund requested by admin.",
    refund_reason: reason || "Refund requested by admin.",
  });

  const supabase = getServiceSupabase();

  await insertOperationLog(supabase, {
    userId: order.user_id,
    runId: order.run_id,
    eventName: "payment_refund_started",
    pagePath: "/api/admin/orders/refund",
    metadata: {
      orderId: order.id,
      orderKind: order.order_kind,
      runId: order.run_id,
      storeId: order.store_id,
      renewId: order.renew_id,
      reason: reason || "Refund requested by admin.",
    },
  }).catch(() => null);

  const stripe = getStripeClient();
  const refund = await stripe.refunds.create({
    payment_intent: order.stripe_payment_intent_id,
    metadata: {
      orderId: order.id,
      orderKind: order.order_kind,
      runId: order.run_id || "",
      storeId: order.store_id || "",
      renewId: order.renew_id || "",
    },
  });

  await patchOrder(order.id, {
    status: "refunded",
    compensation_status: "refunded",
    compensation_note: "Refund completed.",
    refunded_at: new Date().toISOString(),
    stripe_refund_id: refund.id,
    next_retry_at: null,
    error: null,
  });

  await insertOperationLog(supabase, {
    userId: order.user_id,
    runId: order.run_id,
    eventName: "payment_refunded",
    pagePath: "/api/admin/orders/refund",
    metadata: {
      orderId: order.id,
      orderKind: order.order_kind,
      runId: order.run_id,
      storeId: order.store_id,
      renewId: order.renew_id,
      refundId: refund.id,
      reason: reason || "Refund requested by admin.",
    },
  }).catch(() => null);

  return {
    ok: true,
    orderId: order.id,
    status: "refunded",
    refundId: refund.id,
  };
}