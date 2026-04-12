import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

const RENEW_DAY_MAP: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
};

function addDaysFromBase(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
    const appCloudUrl = (process.env.APP_CLOUD_SUPABASE_URL || "").trim();
    const appCloudSecretKey = (process.env.APP_CLOUD_SUPABASE_SECRET_KEY || "").trim();

    if (!stripeSecretKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "STRIPE_SECRET_KEY is required.",
        },
        { status: 500 },
      );
    }

    if (!appCloudUrl || !appCloudSecretKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "APP_CLOUD_SUPABASE_URL and APP_CLOUD_SUPABASE_SECRET_KEY are required.",
        },
        { status: 500 },
      );
    }

    const supabase = await createServerClient();
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
    const storeId = String(body?.storeId || "").trim();
    const renewId = String(body?.renewId || "").trim();
    const renewDays = RENEW_DAY_MAP[renewId];

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "sessionId is required.",
        },
        { status: 400 },
      );
    }

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "storeId is required.",
        },
        { status: 400 },
      );
    }

    if (!renewDays) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid renewId.",
        },
        { status: 400 },
      );
    }

    const stripe = new Stripe(stripeSecretKey);

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

    if (session.metadata?.kind !== "renew_cloud") {
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

    if ((session.metadata?.storeId || "") !== storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe session storeId mismatch.",
        },
        { status: 400 },
      );
    }

    if ((session.metadata?.renewId || "") !== renewId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe session renewId mismatch.",
        },
        { status: 400 },
      );
    }

    const appCloudSupabase = createClient(appCloudUrl, appCloudSecretKey, {
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
      return NextResponse.json(
        {
          ok: false,
          error: storeError.message,
        },
        { status: 500 },
      );
    }

    if (!store) {
      return NextResponse.json(
        {
          ok: false,
          error: "Store not found in app cloud.",
        },
        { status: 404 },
      );
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
      return NextResponse.json(
        {
          ok: false,
          error: updateError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      storeId,
      serviceEndAt: newServiceEndAt.toISOString(),
      deleteAt: newDeleteAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to verify cloud renewal payment.",
      },
      { status: 500 },
    );
  }
}