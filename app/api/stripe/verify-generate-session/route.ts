import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();

    if (!stripeSecretKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "STRIPE_SECRET_KEY is required.",
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
    const sessionId = String(body?.sessionId || "").trim();

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "sessionId is required.",
        },
        { status: 400 },
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-03-31.basil",
    });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.mode !== "payment") {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid Stripe checkout session.",
        },
        { status: 400 },
      );
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe payment is not completed.",
        },
        { status: 400 },
      );
    }

    if (session.metadata?.kind !== "generate") {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe session kind mismatch.",
        },
        { status: 400 },
      );
    }

    if ((session.metadata?.userId || "") !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe session user mismatch.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to verify Stripe payment.",
      },
      { status: 500 },
    );
  }
}