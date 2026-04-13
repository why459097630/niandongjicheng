import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { insertOperationLog } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";
import {
  attachStripeSessionToOrder,
  createGenerateOrder,
} from "@/lib/stripe/orders";

function getGeneratePriceId(): string {
  const value =
    (process.env.STRIPE_PRICE_ID_GENERATE_PRO || "").trim() ||
    (process.env.STRIPE_PRICE_ID_GENERATE || "").trim();

  if (!value) {
    throw new Error("STRIPE_PRICE_ID_GENERATE_PRO or STRIPE_PRICE_ID_GENERATE is required.");
  }

  return value;
}

function createRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:.]/g, "").replace(".000Z", "Z");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ndjc-${iso}-${random}`;
}

type CreateGenerateSessionBody = Pick<
  BuildRequest,
  "appName" | "module" | "uiPack" | "plan" | "adminName" | "adminPassword" | "iconDataUrl"
>;

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

    const body = (await request.json()) as CreateGenerateSessionBody;

    const appName = String(body?.appName || "").trim();
    const moduleName = String(body?.module || "feature-showcase").trim();
    const uiPackName = String(body?.uiPack || "ui-pack-showcase-greenpink").trim();
    const plan = String(body?.plan || "pro").trim().toLowerCase();
    const adminName = String(body?.adminName || "").trim();
    const adminPassword = String(body?.adminPassword || "");
    const iconDataUrl =
      typeof body?.iconDataUrl === "string" && body.iconDataUrl.trim().length > 0
        ? body.iconDataUrl
        : null;

    if (plan !== "pro") {
      return NextResponse.json(
        {
          ok: false,
          error: "Only paid Pro builds can create a Stripe generate session.",
        },
        { status: 400 },
      );
    }

    if (!appName) {
      return NextResponse.json(
        {
          ok: false,
          error: "appName is required.",
        },
        { status: 400 },
      );
    }

    if (!adminName) {
      return NextResponse.json(
        {
          ok: false,
          error: "adminName is required.",
        },
        { status: 400 },
      );
    }

    if (!adminPassword) {
      return NextResponse.json(
        {
          ok: false,
          error: "adminPassword is required.",
        },
        { status: 400 },
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

    const runId = createRunId();

    const order = await createGenerateOrder({
      userId: user.id,
      runId,
      payload: {
        appName,
        module: moduleName,
        uiPack: uiPackName,
        plan,
        adminName,
        adminPassword,
        iconDataUrl,
      },
    });

    await insertOperationLog(supabase, {
      userId: user.id,
      runId,
      eventName: "build_started",
      pagePath: "/api/stripe/create-generate-session",
      metadata: {
        kind: "stripe_generate_checkout_created",
        orderId: order.id,
        appName,
        module: moduleName,
        uiPack: uiPackName,
        plan,
        adminName,
        hasIcon: Boolean(iconDataUrl),
      },
    });

    const stripe = new Stripe(stripeSecretKey);

const session = await stripe.checkout.sessions.create({
  mode: "payment",
  line_items: [
    {
      price: getGeneratePriceId(),
      quantity: 1,
    },
  ],
  customer_email: user.email || undefined,
  success_url: `${siteUrl}/generating?runId=${encodeURIComponent(runId)}&paid=1&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${siteUrl}/checkout?canceled=1`,
  metadata: {
    kind: "generate_app",
    orderId: order.id,
    userId: user.id,
    runId,
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
      runId,
    });
  } catch (error) {
    console.error("NDJC create-generate-session error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to create Stripe checkout session.",
      },
      { status: 500 },
    );
  }
}