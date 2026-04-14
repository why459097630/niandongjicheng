import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  decryptOrderPayload,
  encryptOrderPayload,
} from "@/lib/security/orderPayload";

export type StripeOrderStatus =
  | "created"
  | "checkout_created"
  | "paid"
  | "processing"
  | "processed"
  | "failed"
  | "canceled";

export type StripeOrderKind = "generate_app" | "renew_cloud";

export type GenerateOrderPayload = {
  appName: string;
  module: string;
  uiPack: string;
  plan: string;
  adminName: string;
  adminPassword: string;
  iconDataUrl: string | null;
};

export type RenewOrderPayload = {
  storeId: string;
  renewId: string;
};

export type StripeOrderRecord = {
  id: string;
  order_kind: StripeOrderKind;
  user_id: string;
  run_id: string | null;
  store_id: string | null;
  renew_id: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_event_id: string | null;
  status: StripeOrderStatus;
  amount_subtotal: number | null;
  amount_total: number | null;
  currency: string | null;
  price_id: string | null;
  checkout_completed_at: string | null;
  paid_at: string | null;
  failed_at: string | null;
  canceled_at: string | null;
  payload_ciphertext: string | null;
  payload_iv: string | null;
  payload_tag: string | null;
  error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};
export type AdminRevenueOrderRow = Pick<
  StripeOrderRecord,
  | "id"
  | "order_kind"
  | "user_id"
  | "run_id"
  | "store_id"
  | "renew_id"
  | "stripe_session_id"
  | "stripe_payment_intent_id"
  | "status"
  | "amount_subtotal"
  | "amount_total"
  | "currency"
  | "price_id"
  | "checkout_completed_at"
  | "paid_at"
  | "failed_at"
  | "canceled_at"
  | "processed_at"
  | "error"
  | "created_at"
  | "updated_at"
>;

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

export async function createGenerateOrder(input: {
  userId: string;
  runId: string;
  payload: GenerateOrderPayload;
}): Promise<StripeOrderRecord> {
  const supabase = getServiceSupabase();
  const encrypted = encryptOrderPayload(input.payload);

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .insert({
      order_kind: "generate_app",
      user_id: input.userId,
      run_id: input.runId,
      status: "created",
      payload_ciphertext: encrypted.ciphertext,
      payload_iv: encrypted.iv,
      payload_tag: encrypted.tag,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create generate order.");
  }

  return data as StripeOrderRecord;
}

export async function createRenewOrder(input: {
  userId: string;
  storeId: string;
  renewId: string;
  payload: RenewOrderPayload;
}): Promise<StripeOrderRecord> {
  const supabase = getServiceSupabase();
  const encrypted = encryptOrderPayload(input.payload);

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .insert({
      order_kind: "renew_cloud",
      user_id: input.userId,
      store_id: input.storeId,
      renew_id: input.renewId,
      status: "created",
      payload_ciphertext: encrypted.ciphertext,
      payload_iv: encrypted.iv,
      payload_tag: encrypted.tag,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create renew order.");
  }

  return data as StripeOrderRecord;
}

export async function attachStripeSessionToOrder(
  orderId: string,
  stripeSessionId: string,
): Promise<void> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .update({
      stripe_session_id: stripeSessionId,
      status: "checkout_created",
      error: null,
    })
    .eq("id", orderId)
    .eq("status", "created")
    .is("stripe_session_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Stripe order is not in a state that can attach a checkout session.");
  }
}
export async function syncOrderCheckoutSnapshot(input: {
  orderId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string | null;
  amountSubtotal?: number | null;
  amountTotal?: number | null;
  currency?: string | null;
  priceId?: string | null;
  checkoutCompletedAt?: string | null;
  paidAt?: string | null;
}): Promise<void> {
  const supabase = getServiceSupabase();

  const patch: Record<string, string | number | null> = {
    stripe_session_id: input.stripeSessionId,
    stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
    amount_subtotal:
      typeof input.amountSubtotal === "number" && Number.isFinite(input.amountSubtotal)
        ? Math.round(input.amountSubtotal)
        : null,
    amount_total:
      typeof input.amountTotal === "number" && Number.isFinite(input.amountTotal)
        ? Math.round(input.amountTotal)
        : null,
    currency: input.currency ? String(input.currency).trim().toLowerCase() : null,
    price_id: input.priceId ? String(input.priceId).trim() : null,
    checkout_completed_at: input.checkoutCompletedAt ?? null,
    paid_at: input.paidAt ?? null,
    error: null,
  };

  const { error } = await supabase
    .from("web_stripe_orders")
    .update(patch)
    .eq("id", input.orderId);

  if (error) {
    throw new Error(error.message);
  }
}
export async function getOrderByRunId(
  runId: string,
): Promise<StripeOrderRecord | null> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .select("*")
    .eq("run_id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

export async function getOrderBySessionId(
  stripeSessionId: string,
): Promise<StripeOrderRecord | null> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .select("*")
    .eq("stripe_session_id", stripeSessionId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

export async function getRecentActiveRenewOrder(input: {
  userId: string;
  storeId: string;
  windowSeconds?: number;
}): Promise<StripeOrderRecord | null> {
  const supabase = getServiceSupabase();
  const windowSeconds =
    typeof input.windowSeconds === "number" && input.windowSeconds > 0
      ? input.windowSeconds
      : 60;

  const cutoffIso = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .select("*")
    .eq("order_kind", "renew_cloud")
    .eq("user_id", input.userId)
    .eq("store_id", input.storeId)
    .gte("created_at", cutoffIso)
    .in("status", ["created", "checkout_created", "paid", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

export async function getOrderById(
  orderId: string,
): Promise<StripeOrderRecord | null> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

export async function markOrderPaidBySession(input: {
  stripeSessionId: string;
  stripePaymentIntentId?: string | null;
  stripeEventId?: string | null;
  paidAt?: string | null;
}): Promise<StripeOrderRecord> {
  const supabase = getServiceSupabase();

  const existing = await getOrderBySessionId(input.stripeSessionId);

  if (!existing) {
    throw new Error("Stripe order not found for session.");
  }

  if (
    existing.status === "processed" ||
    existing.status === "processing" ||
    (input.stripeEventId && existing.stripe_event_id === input.stripeEventId)
  ) {
    return existing;
  }

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .update({
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
      stripe_event_id: input.stripeEventId ?? null,
      status: "paid",
      paid_at: input.paidAt ?? new Date().toISOString(),
      error: null,
    })
    .eq("id", existing.id)
    .in("status", ["created", "checkout_created", "failed"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    const latest = await getOrderById(existing.id);

    if (latest) {
      return latest;
    }

    throw new Error("Failed to mark Stripe order as paid.");
  }

  return data as StripeOrderRecord;
}

export async function claimOrderForProcessing(
  orderId: string,
): Promise<StripeOrderRecord | null> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .update({
      status: "processing",
      error: null,
    })
    .eq("id", orderId)
    .eq("status", "paid")
    .is("processed_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as StripeOrderRecord | null) || null;
}

export async function clearOrderPayload(orderId: string): Promise<void> {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("web_stripe_orders")
    .update({
      payload_ciphertext: null,
      payload_iv: null,
      payload_tag: null,
    })
    .eq("id", orderId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function completeOrder(orderId: string): Promise<void> {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("web_stripe_orders")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", orderId)
    .in("status", ["paid", "processing", "processed"]);

  if (error) {
    throw new Error(error.message);
  }
}

export async function failOrder(
  orderId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("web_stripe_orders")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      error: errorMessage,
    })
    .eq("id", orderId)
    .neq("status", "processed");

  if (error) {
    throw new Error(error.message);
  }
}
export async function getAdminRevenueOrders(): Promise<AdminRevenueOrderRow[]> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("web_stripe_orders")
    .select(
      [
        "id",
        "order_kind",
        "user_id",
        "run_id",
        "store_id",
        "renew_id",
        "stripe_session_id",
        "stripe_payment_intent_id",
        "status",
        "amount_subtotal",
        "amount_total",
        "currency",
        "price_id",
        "checkout_completed_at",
        "paid_at",
        "failed_at",
        "canceled_at",
        "processed_at",
        "error",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as unknown[]) as AdminRevenueOrderRow[];

  return rows.map((row) => ({
    ...row,
    amount_subtotal:
      typeof row.amount_subtotal === "number"
        ? row.amount_subtotal
        : row.amount_subtotal == null
          ? null
          : Number(row.amount_subtotal),
    amount_total:
      typeof row.amount_total === "number"
        ? row.amount_total
        : row.amount_total == null
          ? null
          : Number(row.amount_total),
  }));
}

export function readGenerateOrderPayload(
  order: StripeOrderRecord,
): GenerateOrderPayload {
  if (!order.payload_ciphertext || !order.payload_iv || !order.payload_tag) {
    throw new Error("Generate order payload is incomplete.");
  }

  return decryptOrderPayload<GenerateOrderPayload>({
    ciphertext: order.payload_ciphertext,
    iv: order.payload_iv,
    tag: order.payload_tag,
  });
}

export function readRenewOrderPayload(
  order: StripeOrderRecord,
): RenewOrderPayload {
  if (!order.payload_ciphertext || !order.payload_iv || !order.payload_tag) {
    throw new Error("Renew order payload is incomplete.");
  }

  return decryptOrderPayload<RenewOrderPayload>({
    ciphertext: order.payload_ciphertext,
    iv: order.payload_iv,
    tag: order.payload_tag,
  });
}