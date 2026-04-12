import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { insertBuildRecord, insertOperationLog } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";

const GENERATE_PRICE_ID = "price_1TL0LSADTfAordt3iO9jk18v";

type CreateGenerateSessionBody = Pick<
  BuildRequest,
  "appName" | "module" | "uiPack" | "plan" | "adminName" | "adminPassword" | "iconDataUrl"
>;

function createRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:.]/g, "").replace(".000Z", "Z");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ndjc-${iso}-${random}`;
}

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

    const body = (await request.json()) as CreateGenerateSessionBody;

    const appName = String(body?.appName || "").trim();
    const moduleName = String(body?.module || "feature-showcase").trim();
    const uiPackName = String(body?.uiPack || "ui-pack-showcase-greenpink").trim();
    const plan = String(body?.plan || "pro").trim();
    const adminName = String(body?.adminName || "").trim();
    const adminPassword = String(body?.adminPassword || "");
    const iconDataUrl =
      typeof body?.iconDataUrl === "string" && body.iconDataUrl.trim().length > 0
        ? body.iconDataUrl
        : null;

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

    await insertBuildRecord(supabase, {
      userId: user.id,
      runId,
      appName,
      moduleName,
      uiPackName,
      plan,
      storeId: null,
      status: "queued",
      stage: "queued",
      message: "Waiting for payment confirmation from Stripe.",
      workflowRunId: null,
      workflowUrl: null,
      artifactUrl: null,
      downloadUrl: null,
      error: null,
      statusSource: "local_api",
      lastSyncedAt: null,
    });

    await insertOperationLog(supabase, {
      userId: user.id,
      runId,
      eventName: "build_started",
      pagePath: "/api/stripe/create-generate-session",
      metadata: {
        kind: "stripe_generate_pending",
        appName,
        module: moduleName,
        uiPack: uiPackName,
        plan,
        adminName,
        adminPassword,
        iconDataUrl,
      },
    });

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
      success_url: `${siteUrl}/generating?runId=${encodeURIComponent(runId)}&paid=1`,
      cancel_url: `${siteUrl}/checkout?canceled=1`,
      metadata: {
        kind: "generate",
        userId: user.id,
        runId,
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
      runId,
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