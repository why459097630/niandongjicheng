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
  payload_ciphertext: string | null;
  payload_iv: string | null;
  payload_tag: string | null;
  error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
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
      error: errorMessage,
    })
    .eq("id", orderId)
    .neq("status", "processed");

  if (error) {
    throw new Error(error.message);
  }
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