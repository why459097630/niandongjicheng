import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getOrderBySessionId,
  markOrderPaidBySession,
  syncOrderCheckoutSnapshot,
} from "@/lib/stripe/orders";
import { processStripeOrderById } from "@/lib/stripe/compensation";
import {
  capturePayPalOrder,
  readPayPalCaptureSnapshot,
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    const body = await request.json();
    const paypalOrderId = String(body?.paypalOrderId || body?.token || "").trim();
    const expectedKind = String(body?.expectedKind || "").trim();

    if (!paypalOrderId) {
      return NextResponse.json(
        {
          ok: false,
          error: "paypalOrderId is required.",
        },
        { status: 400 },
      );
    }

    const order = await getOrderBySessionId(paypalOrderId);

    if (!order) {
      return NextResponse.json(
        {
          ok: false,
          error: "PayPal order was not found.",
        },
        { status: 404 },
      );
    }

    if (order.user_id !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "This PayPal order does not belong to the current user.",
        },
        { status: 403 },
      );
    }

    if (expectedKind && expectedKind !== order.order_kind) {
      return NextResponse.json(
        {
          ok: false,
          error: "PayPal order kind mismatch.",
        },
        { status: 400 },
      );
    }

    if (order.status === "processed") {
      return NextResponse.json({
        ok: true,
        processed: true,
        orderId: order.id,
        orderStatus: order.status,
        runId: order.run_id,
        storeId: order.store_id,
        renewId: order.renew_id,
      });
    }

    if (order.status === "processing" || order.status === "paid") {
      const processResult = await processStripeOrderById(order.id, "initial");

      return NextResponse.json({
        ok: true,
        processed: processResult.status === "processed",
        orderId: order.id,
        orderStatus: processResult.status,
        runId: order.run_id,
        storeId: order.store_id,
        renewId: order.renew_id,
      });
    }

    const expectedAmountCents = getExpectedAmountCents({
      orderKind: order.order_kind,
      renewId: order.renew_id,
    });

    const capturedOrder = await capturePayPalOrder(paypalOrderId);

    const snapshot = readPayPalCaptureSnapshot({
      capturedOrder,
      expectedCurrency: getPayPalCurrency(),
      expectedAmountCents,
    });

    await syncOrderCheckoutSnapshot({
      orderId: order.id,
      stripeSessionId: paypalOrderId,
      stripePaymentIntentId: snapshot.paypalCaptureId,
      amountSubtotal: snapshot.amountSubtotal,
      amountTotal: snapshot.amountTotal,
      currency: snapshot.currency,
      priceId: getPayPalPriceMarker({
        kind: order.order_kind,
        renewId: order.renew_id,
      }),
      checkoutCompletedAt: snapshot.checkoutCompletedAt,
      paidAt: snapshot.paidAt,
    });

    const paidOrder = await markOrderPaidBySession({
      stripeSessionId: paypalOrderId,
      stripePaymentIntentId: snapshot.paypalCaptureId,
      paidAt: snapshot.paidAt,
    });

    const processResult = await processStripeOrderById(paidOrder.id, "initial");

    return NextResponse.json({
      ok: true,
      processed: processResult.status === "processed",
      orderId: paidOrder.id,
      orderStatus: processResult.status,
      runId: paidOrder.run_id,
      storeId: paidOrder.store_id,
      renewId: paidOrder.renew_id,
    });
  } catch (error) {
    console.error("NDJC PayPal capture order error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 1000) : "Failed to capture PayPal order.",
      },
      { status: 500 },
    );
  }
}