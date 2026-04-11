import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const GENERATE_PRICE_ID = "price_1TL0LSADTfAordt3iO9jk18v";

export async function POST() {
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

    const stripe = new Stripe(stripeSecretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: GENERATE_PRICE_ID,
          quantity: 1,
        },
      ],
      customer_email: user.email || undefined,
      success_url: `${siteUrl}/checkout?stripeSuccess=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/checkout?canceled=1`,
      metadata: {
        kind: "generate",
        userId: user.id,
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
        error: error instanceof Error ? error.message : "Failed to create Stripe checkout session.",
      },
      { status: 500 },
    );
  }
}