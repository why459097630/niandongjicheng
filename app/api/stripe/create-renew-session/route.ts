import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import {
  attachStripeSessionToOrder,
  createRenewOrder,
} from "@/lib/stripe/orders";

function getRenewPriceMap(): Record<string, string> {
  return {
    "30d":
      (process.env.STRIPE_PRICE_ID_RENEW_30D || "").trim() ||
      "price_1TL0NqADTfAordt3ClNQzKCZ",
    "90d":
      (process.env.STRIPE_PRICE_ID_RENEW_90D || "").trim() ||
      "price_1TL1nsADTfAordt3aihIfddI",
    "180d":
      (process.env.STRIPE_PRICE_ID_RENEW_180D || "").trim() ||
      "price_1TL1oqADTfAordt3NQhDZox1",
  };
}

export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    const siteUrl = (process.env.SITE_URL || "").trim();

    if (!stripeSecretKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Payment is temporarily unavailable.",
        },
        { status: 500 },
      );
    }

    if (!siteUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "SITE_URL is required.",
        },
        { status: 500 },
      );
    }

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
    const storeId = String(body?.storeId || "").trim();
    const renewId = String(body?.renewId || "").trim();
    const priceMap = getRenewPriceMap();
    const priceId = priceMap[renewId];

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "storeId is required.",
        },
        { status: 400 },
      );
    }

    if (!priceId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid renewId.",
        },
        { status: 400 },
      );
    }

    const { data: ownedBuild, error: ownedBuildError } = await supabase
      .from("builds")
      .select("store_id")
      .eq("user_id", user.id)
      .eq("store_id", storeId)
      .limit(1)
      .maybeSingle();

    if (ownedBuildError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to verify store ownership.",
        },
        { status: 500 },
      );
    }

    if (!ownedBuild) {
      return NextResponse.json(
        {
          ok: false,
          error: "This store does not belong to the current user.",
        },
        { status: 403 },
      );
    }

    const order = await createRenewOrder({
      userId: user.id,
      storeId,
      renewId,
      payload: {
        storeId,
        renewId,
      },
    });

    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user.email || undefined,
      success_url: `${siteUrl}/renew-cloud?stripeSuccess=1&storeId=${encodeURIComponent(storeId)}&renewId=${encodeURIComponent(renewId)}`,
      cancel_url: `${siteUrl}/renew-cloud?storeId=${encodeURIComponent(storeId)}&canceled=1`,
      metadata: {
        kind: "renew_cloud",
        orderId: order.id,
        userId: user.id,
        storeId,
        renewId,
      },
    });

    if (!session.id || !session.url) {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe checkout URL is empty.",
        },
        { status: 500 },
      );
    }

    await attachStripeSessionToOrder(order.id, session.id);

    return NextResponse.json({
      ok: true,
      url: session.url,
    });
  } catch (error) {
    console.error("NDJC create-renew-session error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to create Stripe renewal session.",
      },
      { status: 500 },
    );
  }
}