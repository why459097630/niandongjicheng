import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { insertOperationLog } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";
import {
  attachStripeSessionToOrder,
  createGenerateOrder,
  getRecentActiveGenerateOrder,
} from "@/lib/stripe/orders";
import {
  createPayPalOrder,
  getPayPalApprovalUrl,
} from "@/lib/paypal/client";
import {
  getPayPalCurrency,
  getPayPalGenerateAmountCents,
} from "@/lib/paypal/pricing";

export const runtime = "nodejs";

type CreateGeneratePayPalOrderBody = Pick<
  BuildRequest,
  "appName" | "module" | "uiPack" | "plan" | "adminName" | "adminPassword" | "iconUrl"
>;

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function createRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:.]/g, "").replace(".000Z", "Z");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ndjc-${iso}-${random}`;
}

function isValidAdminEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return (
    normalized.length >= 5 &&
    normalized.length <= 100 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  );
}

function isValidAdminPassword(value: string): boolean {
  return value.length >= 6 && value.length <= 64;
}

export async function POST(request: NextRequest) {
  try {
    const siteUrl = getRequiredEnv("SITE_URL");
    const currency = getPayPalCurrency();
    const amountCents = getPayPalGenerateAmountCents();

    const body = (await request.json()) as CreateGeneratePayPalOrderBody;

    const appName = String(body?.appName || "").trim();
    const moduleName = String(body?.module || "feature-showcase").trim();
    const uiPackName = String(body?.uiPack || "ui-pack-showcase-greenpink").trim();
    const plan = String(body?.plan || "pro").trim().toLowerCase();
    const adminName = String(body?.adminName || "").trim().toLowerCase();
    const adminPassword = String(body?.adminPassword || "");
    const iconUrl =
      typeof body?.iconUrl === "string" && body.iconUrl.trim().length > 0
        ? body.iconUrl.trim()
        : null;

    if (plan !== "pro") {
      return NextResponse.json(
        {
          ok: false,
          error: "Only paid Pro builds can create a PayPal generate order.",
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

    if (!isValidAdminEmail(adminName)) {
      return NextResponse.json(
        {
          ok: false,
          error: "adminName must be a valid email address between 5 and 100 characters.",
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

    if (!isValidAdminPassword(adminPassword)) {
      return NextResponse.json(
        {
          ok: false,
          error: "adminPassword must be between 6 and 64 characters.",
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

const recentActiveGenerateOrder = await getRecentActiveGenerateOrder({
  userId: user.id,
  windowSeconds: 60,
});

if (recentActiveGenerateOrder) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "A paid generation payment is already in progress. Please finish the current payment or wait one minute before trying again.",
      status: recentActiveGenerateOrder.status,
      runId: recentActiveGenerateOrder.run_id,
    },
    { status: 409 },
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
    iconUrl,
  },
});

    const paypalOrder = await createPayPalOrder({
      orderId: order.id,
      amountCents,
      currency,
      description: "Think It Done Pro customer hub setup with 30 days of cloud access.",
      customId: order.id,
      returnUrl: `${siteUrl}/result?runId=${encodeURIComponent(runId)}&paid=1&provider=paypal`,
      cancelUrl: `${siteUrl}/checkout?canceled=1`,
    });

    await attachStripeSessionToOrder(order.id, paypalOrder.id);

await insertOperationLog(supabase, {
  userId: user.id,
  runId,
  eventName: "stripe_session_created",
  pagePath: "/api/paypal/create-generate-order",
  metadata: {
    kind: "paypal_generate_order_created",
    orderId: order.id,
    paypalOrderId: paypalOrder.id,
    amountCents,
    currency,
    appName,
    module: moduleName,
    uiPack: uiPackName,
    plan,
    adminName,
    hasIcon: Boolean(iconUrl),
  },
});

    return NextResponse.json({
      ok: true,
      url: getPayPalApprovalUrl(paypalOrder),
      runId,
      paypalOrderId: paypalOrder.id,
    });
  } catch (error) {
    console.error("NDJC create PayPal generate order error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 1000) : "Failed to create PayPal order.",
      },
      { status: 500 },
    );
  }
}