import { NextRequest, NextResponse } from "next/server";
import {
  getOrderBySessionId,
  markOrderPaidBySession,
  syncOrderCheckoutSnapshot,
} from "@/lib/stripe/orders";
import { processStripeOrderById } from "@/lib/stripe/compensation";
import {
  type PayPalWebhookEvent,
  verifyPayPalWebhook,
} from "@/lib/paypal/client";
import {
  getPayPalCurrency,
  getPayPalGenerateAmountCents,
  getPayPalPriceMarker,
  getPayPalRenewAmountCents,
} from "@/lib/paypal/pricing";

export const runtime = "nodejs";

function getExpectedAmountCents(input: {
  orderKind: "generate_app" | "renew_cloud";
  renewId?: string | null;
}) {
  if (input.orderKind === "generate_app") {
    return getPayPalGenerateAmountCents();
  }

  return getPayPalRenewAmountCents(input.renewId || "");
}

function readWebhookOrderId(event: PayPalWebhookEvent): string {
  return String(event.resource?.supplementary_data?.related_ids?.order_id || "").trim();
}

function readWebhookCaptureId(event: PayPalWebhookEvent): string {
  return String(event.resource?.id || "").trim();
}

function readWebhookAmountCents(event: PayPalWebhookEvent): {
  currency: string;
  amountCents: number;
} {
  const currency = String(event.resource?.amount?.currency_code || "").trim().toUpperCase();
  const amountValue = Number(event.resource?.amount?.value || "0");

  return {
    currency,
    amountCents: Math.round(amountValue * 100),
  };
}

export async function POST(request: NextRequest) {
  try {
    const event = (await request.json()) as PayPalWebhookEvent;

    const verified = await verifyPayPalWebhook({
      headers: request.headers,
      event,
    });

    if (!verified) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid PayPal webhook signature.",
        },
        { status: 400 },
      );
    }

    const eventType = String(event.event_type || "").trim();

    if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
      return NextResponse.json({ ok: true });
    }

    const paypalOrderId = readWebhookOrderId(event);
    const paypalCaptureId = readWebhookCaptureId(event);

    if (!paypalOrderId || !paypalCaptureId) {
      return NextResponse.json({ ok: true });
    }

    const order = await getOrderBySessionId(paypalOrderId);

    if (!order) {
      return NextResponse.json({ ok: true });
    }

    if (order.status === "processed") {
      return NextResponse.json({ ok: true });
    }

    const amountSnapshot = readWebhookAmountCents(event);
    const expectedCurrency = getPayPalCurrency();
    const expectedAmountCents = getExpectedAmountCents({
      orderKind: order.order_kind,
      renewId: order.renew_id,
    });

    if (amountSnapshot.currency !== expectedCurrency.toUpperCase()) {
      throw new Error(
        `Unexpected PayPal webhook currency. expected=${expectedCurrency} actual=${amountSnapshot.currency}`,
      );
    }

    if (amountSnapshot.amountCents !== expectedAmountCents) {
      throw new Error(
        `Unexpected PayPal webhook amount. expected=${expectedAmountCents} actual=${amountSnapshot.amountCents}`,
      );
    }

    const nowIso = new Date().toISOString();

    await syncOrderCheckoutSnapshot({
      orderId: order.id,
      stripeSessionId: paypalOrderId,
      stripePaymentIntentId: paypalCaptureId,
      amountSubtotal: amountSnapshot.amountCents,
      amountTotal: amountSnapshot.amountCents,
      currency: amountSnapshot.currency.toLowerCase(),
      priceId: getPayPalPriceMarker({
        kind: order.order_kind,
        renewId: order.renew_id,
      }),
      checkoutCompletedAt: nowIso,
      paidAt: nowIso,
    });

    const paidOrder = await markOrderPaidBySession({
      stripeSessionId: paypalOrderId,
      stripePaymentIntentId: paypalCaptureId,
      stripeEventId: String(event.id || "").trim() || null,
      paidAt: nowIso,
    });

    await processStripeOrderById(paidOrder.id, "initial");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("NDJC PayPal webhook error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to handle PayPal webhook.",
      },
      { status: 500 },
    );
  }
}