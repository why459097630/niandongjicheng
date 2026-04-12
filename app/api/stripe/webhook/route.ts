import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { provisionStore } from "@/lib/build/provisionStore";
import { startBuild } from "@/lib/build/startBuild";
import { getBuildRecordByRunId } from "@/lib/build/storage";
import type { BuildRequest } from "@/lib/build/types";

export const runtime = "nodejs";

type PendingBuildMetadata = {
  kind?: string;
  appName?: string;
  module?: string;
  uiPack?: string;
  plan?: string;
  adminName?: string;
  adminPassword?: string;
  iconDataUrl?: string | null;
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
    const stripeWebhookSecret = getRequiredEnv("STRIPE_WEBHOOK_SECRET");
    const supabaseUrl = getRequiredEnv("WEB_SUPABASE_URL");
    const supabaseSecretKey = getRequiredEnv("WEB_SUPABASE_SERVICE_ROLE_KEY");

    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature") || "";

    const stripe = new Stripe(stripeSecretKey);
    const event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);

    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ ok: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;

    if ((session.metadata?.kind || "") !== "generate") {
      return NextResponse.json({ ok: true });
    }

    const userId = String(session.metadata?.userId || "").trim();
    const runId = String(session.metadata?.runId || "").trim();

    if (!userId || !runId) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createSupabaseClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const existingRecord = await getBuildRecordByRunId(supabase, runId);

    if (existingRecord?.status === "running" || existingRecord?.status === "success") {
      return NextResponse.json({ ok: true });
    }

    const { data: pendingRows, error: pendingError } = await supabase
      .from("user_operation_logs")
      .select("metadata")
      .eq("user_id", userId)
      .eq("run_id", runId)
      .eq("event_name", "build_started")
      .eq("page_path", "/api/stripe/create-generate-session")
      .order("occurred_at", { ascending: false })
      .limit(1);

    if (pendingError) {
      throw new Error(pendingError.message);
    }

    const pendingMetadata = ((pendingRows || [])[0]?.metadata || {}) as PendingBuildMetadata;

    if (pendingMetadata.kind !== "stripe_generate_pending") {
      throw new Error("Pending paid build payload not found.");
    }

    const buildInput: BuildRequest = {
      appName: String(pendingMetadata.appName || "").trim(),
      module: String(pendingMetadata.module || "feature-showcase").trim(),
      uiPack: String(pendingMetadata.uiPack || "ui-pack-showcase-greenpink").trim(),
      plan: String(pendingMetadata.plan || "pro").trim(),
      adminName: String(pendingMetadata.adminName || "").trim(),
      adminPassword: String(pendingMetadata.adminPassword || ""),
      iconDataUrl:
        typeof pendingMetadata.iconDataUrl === "string" &&
        pendingMetadata.iconDataUrl.trim().length > 0
          ? pendingMetadata.iconDataUrl
          : null,
      runId,
      userId,
    };

    if (!buildInput.appName) {
      throw new Error("Pending build appName is missing.");
    }

    if (!buildInput.adminName) {
      throw new Error("Pending build adminName is missing.");
    }

    if (!buildInput.adminPassword) {
      throw new Error("Pending build adminPassword is missing.");
    }

    let storeId = existingRecord?.storeId || "";

    if (!storeId) {
      const provisionResult = await provisionStore({
        module: buildInput.module,
        plan: buildInput.plan,
        adminName: buildInput.adminName,
        adminPassword: buildInput.adminPassword,
      });

      if (!provisionResult.ok || !provisionResult.storeId) {
        throw new Error(`Failed to provision store after payment. Result: ${JSON.stringify(provisionResult)}`);
      }

      storeId = provisionResult.storeId;
    }

    const buildResult = await startBuild(supabase, {
      ...buildInput,
      storeId,
    });

    if (!buildResult.ok) {
      throw new Error(buildResult.error || "Failed to start paid build.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("NDJC Stripe webhook error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to handle Stripe webhook.",
      },
      { status: 500 },
    );
  }
}