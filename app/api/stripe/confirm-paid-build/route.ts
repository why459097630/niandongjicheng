import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getBuildRecordByRunId } from "@/lib/build/storage";
import { provisionStore } from "@/lib/build/provisionStore";
import { startBuild } from "@/lib/build/startBuild";
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

    const body = (await request.json()) as {
      runId?: string;
      sessionId?: string;
    };

    const runId = String(body?.runId || "").trim();
    const sessionId = String(body?.sessionId || "").trim();

    if (!runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "runId is required.",
        },
        { status: 400 },
      );
    }

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "sessionId is required.",
        },
        { status: 400 },
      );
    }

    const stripeSecretKey = getRequiredEnv("STRIPE_SECRET_KEY");
    const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

    const stripe = new Stripe(stripeSecretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if ((session.metadata?.kind || "") !== "generate") {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid Stripe session kind.",
        },
        { status: 400 },
      );
    }

    const sessionUserId = String(session.metadata?.userId || "").trim();
    const sessionRunId = String(session.metadata?.runId || "").trim();

    if (!sessionUserId || !sessionRunId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Stripe session metadata is incomplete.",
        },
        { status: 400 },
      );
    }

    if (sessionUserId !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "This payment session does not belong to the current user.",
        },
        { status: 403 },
      );
    }

    if (sessionRunId !== runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "runId does not match the Stripe session.",
        },
        { status: 400 },
      );
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        {
          ok: false,
          error: "Payment is not completed yet.",
        },
        { status: 409 },
      );
    }

    const serviceSupabase = createSupabaseClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const existingRecord = await getBuildRecordByRunId(serviceSupabase, runId);

    if (existingRecord) {
      return NextResponse.json({
        ok: true,
        alreadyStarted: true,
        runId,
        stage: existingRecord.stage,
        message: existingRecord.message,
      });
    }

    const { data: pendingRows, error: pendingError } = await serviceSupabase
      .from("user_operation_logs")
      .select("metadata")
      .eq("user_id", user.id)
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
      return NextResponse.json(
        {
          ok: false,
          error: "Pending paid build payload not found.",
        },
        { status: 404 },
      );
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
      userId: user.id,
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

    const provisionResult = await provisionStore({
      module: buildInput.module,
      plan: buildInput.plan,
      adminName: buildInput.adminName,
      adminPassword: buildInput.adminPassword,
    });

    if (!provisionResult.ok || !provisionResult.storeId) {
      throw new Error(
        `Failed to provision store after payment. Result: ${JSON.stringify(provisionResult)}`,
      );
    }

    const buildResult = await startBuild(serviceSupabase, {
      ...buildInput,
      storeId: provisionResult.storeId,
    });

    if (!buildResult.ok) {
      throw new Error(buildResult.error || "Failed to start paid build.");
    }

    return NextResponse.json({
      ok: true,
      runId,
      started: true,
      stage: buildResult.stage || "queued",
      message: buildResult.message || "Paid build started.",
    });
  } catch (error) {
    console.error("NDJC confirm-paid-build error", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to confirm paid build.",
      },
      { status: 500 },
    );
  }
}