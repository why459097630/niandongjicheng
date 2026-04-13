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
    const storeId = String(body?.storeId || "").trim();
    const renewId = String(body?.renewId || "").trim();

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
      return NextResponse.json(
        {
          ok: true,
          processed: false,
          status: "checkout_created",
        },
        { status: 200 },
      );
    }

    if (order.user_id !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "This renewal order does not belong to the current user.",
        },
        { status: 403 },
      );
    }

    if (storeId && order.store_id !== storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Renew order storeId mismatch.",
        },
        { status: 400 },
      );
    }

    if (renewId && order.renew_id !== renewId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Renew order renewId mismatch.",
        },
        { status: 400 },
      );
    }

    if (order.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          processed: false,
          status: order.status,
          error: order.error || "Cloud renewal failed.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      processed: order.status === "processed",
      status: order.status,
    });
  } catch (error) {
    console.error("NDJC verify-renew-session error", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to check cloud renewal status.",
      },
      { status: 500 },
    );
  }
}