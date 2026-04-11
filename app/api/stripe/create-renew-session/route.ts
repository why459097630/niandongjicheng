import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const RENEW_PRICE_MAP: Record<string, string> = {
  "30d": "price_1TL0NqADTfAordt3ClNQzKCZ",
  "90d": "price_1TL1nsADTfAordt3aihIfddI",
  "180d": "price_1TL1oqADTfAordt3NQhDZox1",
};

export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    const siteUrl = (process.env.SITE_URL || "").trim();

    if (!stripeSecretKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "STRIPE_SECRET_KEY is required.",
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
    const priceId = RENEW_PRICE_MAP[renewId];

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

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-03-31.basil",
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      customer_email: user.email || undefined,
      success_url: `${siteUrl}/renew-cloud?stripeSuccess=1&session_id={CHECKOUT_SESSION_ID}&storeId=${encodeURIComponent(storeId)}`,
      cancel_url: `${siteUrl}/renew-cloud?storeId=${encodeURIComponent(storeId)}&canceled=1`,
      metadata: {
        kind: "renew_cloud",
        userId: user.id,
        storeId,
        renewId,
      },
    });

    if (!session.url) {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe checkout URL is empty.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      url: session.url,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to create Stripe renewal session.",
      },
      { status: 500 },
    );
  }
}