import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrderBySessionId } from "@/lib/stripe/orders";

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

    const order = await getOrderBySessionId(sessionId);

    if (!order) {
      return NextResponse.json({
        ok: true,
        processed: false,
        status: "checkout_created",
      });
    }

    if (order.user_id !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "This payment session does not belong to the current user.",
        },
        { status: 403 },
      );
    }

    if (order.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          processed: false,
          status: order.status,
          error: order.error || "Paid build failed.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      processed: order.status === "processed",
      status: order.status,
      runId: order.run_id,
    });
  } catch (error) {
    console.error("NDJC verify-generate-session error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to check paid build status.",
      },
      { status: 500 },
    );
  }
}