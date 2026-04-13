import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { provisionStore } from "@/lib/build/provisionStore";
import { startBuild } from "@/lib/build/startBuild";
import { getBuildRecordByRunId } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";
import type { StripeOrderRecord } from "@/lib/stripe/orders";
import {
  claimOrderForProcessing,
  completeOrder,
  failOrder,
  getOrderById,
  getOrderBySessionId,
  markOrderPaidBySession,
  readGenerateOrderPayload,
  readRenewOrderPayload,
} from "@/lib/stripe/orders";

export const runtime = "nodejs";

const RENEW_DAY_MAP: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getGeneratePriceId(): string {
  return (
    (process.env.STRIPE_PRICE_ID_GENERATE_PRO || "").trim() ||
    getRequiredEnv("STRIPE_PRICE_ID_GENERATE")
  );
}

function getRenewPriceId(renewId: string): string {
  const priceMap: Record<string, string> = {
    "30d": getRequiredEnv("STRIPE_PRICE_ID_RENEW_30D"),
    "90d": getRequiredEnv("STRIPE_PRICE_ID_RENEW_90D"),
    "180d": getRequiredEnv("STRIPE_PRICE_ID_RENEW_180D"),
  };

  const priceId = priceMap[renewId];

  if (!priceId) {
    throw new Error("Invalid renewId.");
  }

  return priceId;
}

async function assertSessionPricing(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  order: StripeOrderRecord,
) {
  const fullSession = await stripe.checkout.sessions.retrieve(session.id as string, {
    expand: ["line_items.data.price"],
  });

  const currency = String(fullSession.currency || "").trim().toLowerCase();

  if (currency !== "usd") {
    throw new Error(`Unexpected Stripe session currency: ${currency || "empty"}.`);
  }

  const lineItems = fullSession.line_items?.data || [];

  if (lineItems.length !== 1) {
    throw new Error(`Unexpected Stripe line item count: ${lineItems.length}.`);
  }

  const lineItem = lineItems[0];
  const linePrice = lineItem.price;
  const actualPriceId =
    linePrice && typeof linePrice !== "string" ? String(linePrice.id || "").trim() : "";
  const quantity = Number(lineItem.quantity || 0);
  const amountTotal = Number(fullSession.amount_total || 0);

  if (!actualPriceId) {
    throw new Error("Stripe line item price id is missing.");
  }

  if (quantity !== 1) {
    throw new Error(`Unexpected Stripe line item quantity: ${quantity}.`);
  }

  if (amountTotal <= 0) {
    throw new Error(`Unexpected Stripe session amount_total: ${amountTotal}.`);
  }

  if (order.order_kind === "generate_app") {
    const expectedPriceId = getGeneratePriceId();

    if (actualPriceId !== expectedPriceId) {
      throw new Error(
        `Stripe generate price mismatch. expected=${expectedPriceId} actual=${actualPriceId}`,
      );
    }

    if (linePrice && typeof linePrice !== "string") {
      const expectedUnitAmount = Number(linePrice.unit_amount || 0);

      if (expectedUnitAmount <= 0) {
        throw new Error(`Unexpected Stripe generate unit_amount: ${expectedUnitAmount}.`);
      }

      if (amountTotal !== expectedUnitAmount * quantity) {
        throw new Error(
          `Stripe generate amount mismatch. expected=${expectedUnitAmount * quantity} actual=${amountTotal}`,
        );
      }
    }

    return;
  }

  if (order.order_kind === "renew_cloud") {
    const expectedPriceId = getRenewPriceId(order.renew_id || "");

    if (actualPriceId !== expectedPriceId) {
      throw new Error(
        `Stripe renew price mismatch. expected=${expectedPriceId} actual=${actualPriceId}`,
      );
    }

    if (linePrice && typeof linePrice !== "string") {
      const expectedUnitAmount = Number(linePrice.unit_amount || 0);

      if (expectedUnitAmount <= 0) {
        throw new Error(`Unexpected Stripe renew unit_amount: ${expectedUnitAmount}.`);
      }

      if (amountTotal !== expectedUnitAmount * quantity) {
        throw new Error(
          `Stripe renew amount mismatch. expected=${expectedUnitAmount * quantity} actual=${amountTotal}`,
        );
      }
    }

    return;
  }

  throw new Error("Unsupported Stripe order kind.");
}

function addDaysFromBase(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function assertSessionMatchesOrderMetadata(
  session: Stripe.Checkout.Session,
  order: StripeOrderRecord,
) {
  const metadataKind = String(session.metadata?.kind || "").trim();
  const metadataOrderId = String(session.metadata?.orderId || "").trim();
  const metadataUserId = String(session.metadata?.userId || "").trim();
  const metadataRunId = String(session.metadata?.runId || "").trim();
  const metadataStoreId = String(session.metadata?.storeId || "").trim();
  const metadataRenewId = String(session.metadata?.renewId || "").trim();

  if (metadataOrderId && metadataOrderId !== order.id) {
    throw new Error("Stripe session orderId does not match the stored order.");
  }

  if (metadataUserId && metadataUserId !== order.user_id) {
    throw new Error("Stripe session userId does not match the stored order.");
  }

  if (order.order_kind === "generate_app") {
    if (metadataKind && metadataKind !== "generate_app") {
      throw new Error("Stripe session kind mismatch for generate order.");
    }

    if (metadataRunId && metadataRunId !== (order.run_id || "")) {
      throw new Error("Stripe session runId does not match the stored order.");
    }
  }

  if (order.order_kind === "renew_cloud") {
    if (metadataKind && metadataKind !== "renew_cloud") {
      throw new Error("Stripe session kind mismatch for renew order.");
    }

    if (metadataStoreId && metadataStoreId !== (order.store_id || "")) {
      throw new Error("Stripe session storeId does not match the stored order.");
    }

    if (metadataRenewId && metadataRenewId !== (order.renew_id || "")) {
      throw new Error("Stripe session renewId does not match the stored order.");
    }
  }
}

async function applyRenewalToStore(storeId: string, renewId: string) {
  const appCloudUrl = getRequiredEnv("APP_CLOUD_SUPABASE_URL");
  const appCloudSecretKey = getRequiredEnv("APP_CLOUD_SUPABASE_SECRET_KEY");
  const renewDays = RENEW_DAY_MAP[renewId];

  if (!renewDays) {
    throw new Error("Invalid renewId.");
  }

  const appCloudSupabase = createSupabaseClient(appCloudUrl, appCloudSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: store, error: storeError } = await appCloudSupabase
    .from("stores")
    .select("store_id, service_end_at")
    .eq("store_id", storeId)
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
  const newDeleteAt = addDaysFromBase(newServiceEndAt, 30);

  const { error: updateError } = await appCloudSupabase
    .from("stores")
    .update({
      service_status: "active",
      is_write_allowed: true,
      service_end_at: newServiceEndAt.toISOString(),
      delete_at: newDeleteAt.toISOString(),
    })
    .eq("store_id", storeId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function POST(request: NextRequest) {
  let processingOrderId = "";

  try {
    const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
    const stripeWebhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = getRequiredEnv("WEB_SUPABASE_URL");
    const supabaseSecretKey = getRequiredEnv("WEB_SUPABASE_SERVICE_ROLE_KEY");

    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature") || "";

    const stripe = new Stripe(stripeSecretKey);
    const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);

    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ ok: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    if (!session.id) {
      throw new Error("Stripe checkout session id is missing.");
    }

    if (session.mode !== "payment") {
      return NextResponse.json({ ok: true });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ ok: true });
    }

    const orderIdFromMetadata = String(session.metadata?.orderId || "").trim();
    const orderFromMetadata = orderIdFromMetadata
      ? await getOrderById(orderIdFromMetadata)
      : null;
    const orderFromSession = await getOrderBySessionId(session.id);

    if (orderFromMetadata && orderFromSession && orderFromMetadata.id !== orderFromSession.id) {
      throw new Error("Stripe session resolved to two different orders.");
    }

const baseOrder = orderFromMetadata || orderFromSession;

if (!baseOrder) {
  return NextResponse.json({ ok: true });
}

assertSessionMatchesOrderMetadata(session, baseOrder);
await assertSessionPricing(stripe, session, baseOrder);

const paidOrder = await markOrderPaidBySession({
  stripeSessionId: session.id,
  stripePaymentIntentId:
    typeof session.payment_intent === "string" ? session.payment_intent : null,
  stripeEventId: event.id,
});

    const claimedOrder = await claimOrderForProcessing(paidOrder.id);

    if (!claimedOrder) {
      return NextResponse.json({ ok: true });
    }

    processingOrderId = claimedOrder.id;

    if (claimedOrder.order_kind === "renew_cloud") {
      const renewPayload = readRenewOrderPayload(claimedOrder);

      await applyRenewalToStore(renewPayload.storeId, renewPayload.renewId);
      await completeOrder(claimedOrder.id);

      return NextResponse.json({ ok: true });
    }

    if (claimedOrder.order_kind === "generate_app") {
      if (!claimedOrder.run_id) {
        throw new Error("Generate order runId is missing.");
      }

      const buildPayload = readGenerateOrderPayload(claimedOrder);

      if (buildPayload.plan !== "pro") {
        throw new Error("Paid generate order plan must be pro.");
      }

      const supabase = createSupabaseClient(supabaseUrl, supabaseSecretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const existingRecord = await getBuildRecordByRunId(supabase, claimedOrder.run_id);

      if (
        existingRecord &&
        (existingRecord.status === "queued" ||
          existingRecord.status === "running" ||
          existingRecord.status === "success")
      ) {
        await completeOrder(claimedOrder.id);
        return NextResponse.json({ ok: true });
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
        runId: claimedOrder.run_id,
        userId: claimedOrder.user_id,
        storeId,
      };

      const buildResult = await startBuild(supabase, buildInput);

      if (!buildResult.ok) {
        throw new Error(buildResult.error || "Failed to start paid build.");
      }

      await completeOrder(claimedOrder.id);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("NDJC Stripe webhook error", error);

    if (processingOrderId) {
      try {
        await failOrder(
          processingOrderId,
          error instanceof Error ? error.message : "Failed to process Stripe webhook.",
        );
      } catch (orderError) {
        console.error("NDJC Stripe webhook failOrder error", orderError);
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to handle Stripe webhook.",
      },
      { status: 500 },
    );
  }
}