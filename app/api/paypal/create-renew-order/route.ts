import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { insertOperationLog } from "@/lib/build/storage";
import {
  attachStripeSessionToOrder,
  createRenewOrder,
  getRecentActiveRenewOrder,
} from "@/lib/stripe/orders";
import {
  createPayPalOrder,
  getPayPalApprovalUrl,
} from "@/lib/paypal/client";
import {
  getPayPalCurrency,
  getPayPalRenewAmountCents,
} from "@/lib/paypal/pricing";

export const runtime = "nodejs";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
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
    .select("store_id, service_status, delete_at")
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!store) {
    throw new Error("This cloud store has already been deleted and cannot be renewed.");
  }

  if (store.service_status === "deleted") {
    throw new Error("Deleted cloud stores cannot be renewed.");
  }

  const deleteAtMs = store.delete_at ? new Date(store.delete_at).getTime() : Number.NaN;

  if (Number.isFinite(deleteAtMs) && deleteAtMs <= Date.now()) {
    throw new Error("This cloud store has already passed its deletion time and cannot be renewed.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const siteUrl = getRequiredEnv("SITE_URL");
    const currency = getPayPalCurrency();

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

    if (renewId !== "30d" && renewId !== "90d" && renewId !== "180d") {
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

    const amountCents = getPayPalRenewAmountCents(renewId);

    const order = await createRenewOrder({
      userId: user.id,
      storeId,
      renewId,
      payload: {
        storeId,
        renewId,
      },
    });

    const paypalOrder = await createPayPalOrder({
      orderId: order.id,
      amountCents,
      currency,
      description: `Think It Done cloud renewal ${renewId}.`,
      customId: order.id,
      returnUrl: `${siteUrl}/renew-cloud?paypalSuccess=1&renewId=${encodeURIComponent(renewId)}`,
      cancelUrl: `${siteUrl}/renew-cloud?canceled=1`,
    });

    await attachStripeSessionToOrder(order.id, paypalOrder.id);

    await insertOperationLog(supabase, {
      userId: user.id,
      runId: null,
      eventName: "paypal_order_created",
      pagePath: "/api/paypal/create-renew-order",
      metadata: {
        kind: "paypal_renew_order_created",
        orderId: order.id,
        paypalOrderId: paypalOrder.id,
        amountCents,
        currency,
        storeId,
        renewId,
      },
    });

    return NextResponse.json({
      ok: true,
      url: getPayPalApprovalUrl(paypalOrder),
      paypalOrderId: paypalOrder.id,
    });
  } catch (error) {
    console.error("NDJC create PayPal renew order error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 1000) : "Failed to create PayPal renewal order.",
      },
      { status: 500 },
    );
  }
}