import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  attachStripeSessionToOrder,
  createRenewOrder,
  getRecentActiveRenewOrder,
} from "@/lib/stripe/orders";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
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

async function assertStoreCanBeRenewed(storeId: string) {
  const appCloudUrl = getRequiredEnv("APP_CLOUD_SUPABASE_URL");
  const appCloudSecretKey = getRequiredEnv("APP_CLOUD_SUPABASE_SECRET_KEY");

  const appCloudSupabase = createSupabaseClient(appCloudUrl, appCloudSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: store, error } = await appCloudSupabase
    .from("stores")
    .select("store_id, service_status")
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!store) {
    throw new Error("Store not found in app cloud.");
  }

  if (store.service_status === "deleted") {
    throw new Error("Deleted stores cannot be renewed.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
    const siteUrl = getRequiredEnv("SITE_URL");

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

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "storeId is required.",
        },
        { status: 400 },
      );
    }

    if (!renewId) {
      return NextResponse.json(
        {
          ok: false,
          error: "renewId is required.",
        },
        { status: 400 },
      );
    }

    const priceId = getRenewPriceId(renewId);

    const { data: ownedBuild, error: ownedBuildError } = await supabase
      .from("builds")
      .select("store_id, plan, status")
      .eq("user_id", user.id)
      .eq("store_id", storeId)
      .eq("status", "success")
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

    if (ownedBuild.plan === "free") {
      return NextResponse.json(
        {
          ok: false,
          error: "Free builds do not support paid cloud renewal.",
        },
        { status: 403 },
      );
    }

    await assertStoreCanBeRenewed(storeId);

    const recentActiveRenewOrder = await getRecentActiveRenewOrder({
      userId: user.id,
      storeId,
      windowSeconds: 60,
    });

    if (recentActiveRenewOrder) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A cloud renewal payment is already in progress. Please finish the current payment or wait one minute before trying again.",
          status: recentActiveRenewOrder.status,
        },
        { status: 409 },
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
      success_url: `${siteUrl}/renew-cloud?stripeSuccess=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/renew-cloud?canceled=1`,
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
        error: error instanceof Error ? error.message : "Failed to create Stripe renewal session.",
      },
      { status: 500 },
    );
  }
}