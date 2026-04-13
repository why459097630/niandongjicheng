import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { provisionStore } from "@/lib/build/provisionStore";
import { startBuild } from "@/lib/build/startBuild";
import { getBuildRecordByRunId } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";
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

function addDaysFromBase(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
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

    if (session.payment_status !== "paid") {
      return NextResponse.json({ ok: true });
    }

    const orderIdFromMetadata = String(session.metadata?.orderId || "").trim();
    const orderFromMetadata = orderIdFromMetadata
      ? await getOrderById(orderIdFromMetadata)
      : null;
    const orderFromSession = session.id
      ? await getOrderBySessionId(session.id)
      : null;

    const baseOrder = orderFromMetadata || orderFromSession;

    if (!baseOrder) {
      return NextResponse.json({ ok: true });
    }

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