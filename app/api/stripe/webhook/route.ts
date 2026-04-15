import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import type { StripeOrderRecord } from "@/lib/stripe/orders";
import {
  getOrderById,
  getOrderBySessionId,
  markOrderPaidBySession,
  readGenerateOrderPayload,
  syncOrderCheckoutSnapshot,
} from "@/lib/stripe/orders";
import { processStripeOrderById } from "@/lib/stripe/compensation";

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
): Promise<{
  stripePaymentIntentId: string | null;
  amountSubtotal: number;
  amountTotal: number;
  currency: string;
  priceId: string;
  checkoutCompletedAt: string;
  paidAt: string;
}> {
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
  const amountSubtotal = Number(fullSession.amount_subtotal || 0);
  const amountTotal = Number(fullSession.amount_total || 0);
  const stripePaymentIntentId =
    typeof fullSession.payment_intent === "string" ? fullSession.payment_intent : null;
  const checkoutCompletedAt =
    typeof fullSession.created === "number" && Number.isFinite(fullSession.created)
      ? new Date(fullSession.created * 1000).toISOString()
      : new Date().toISOString();
  const paidAt =
    typeof fullSession.created === "number" && Number.isFinite(fullSession.created)
      ? new Date(fullSession.created * 1000).toISOString()
      : new Date().toISOString();

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

    return {
      stripePaymentIntentId,
      amountSubtotal,
      amountTotal,
      currency,
      priceId: actualPriceId,
      checkoutCompletedAt,
      paidAt,
    };
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

    return {
      stripePaymentIntentId,
      amountSubtotal,
      amountTotal,
      currency,
      priceId: actualPriceId,
      checkoutCompletedAt,
      paidAt,
    };
  }

  throw new Error("Unsupported Stripe order kind.");
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



export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
    const stripeWebhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");

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

    const pricingSnapshot = await assertSessionPricing(stripe, session, baseOrder);

    await syncOrderCheckoutSnapshot({
      orderId: baseOrder.id,
      stripeSessionId: session.id,
      stripePaymentIntentId: pricingSnapshot.stripePaymentIntentId,
      amountSubtotal: pricingSnapshot.amountSubtotal,
      amountTotal: pricingSnapshot.amountTotal,
      currency: pricingSnapshot.currency,
      priceId: pricingSnapshot.priceId,
      checkoutCompletedAt: pricingSnapshot.checkoutCompletedAt,
      paidAt: pricingSnapshot.paidAt,
    });

    const paidOrder = await markOrderPaidBySession({
      stripeSessionId: session.id,
      stripePaymentIntentId: pricingSnapshot.stripePaymentIntentId,
      stripeEventId: event.id,
      paidAt: pricingSnapshot.paidAt,
    });

    await processStripeOrderById(paidOrder.id, "initial");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("NDJC Stripe webhook error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to handle Stripe webhook.",
      },
      { status: 500 },
    );
  }
}
