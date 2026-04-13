import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrderBySessionId } from "@/lib/stripe/orders";

const RENEW_VERIFY_MIN_INTERVAL_MS = 1200;

async function getLastRenewVerifyAt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("user_operation_logs")
    .select("occurred_at")
    .eq("user_id", userId)
    .eq("event_name", "renew_status_polled")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.occurred_at ? new Date(data.occurred_at) : null;
}

async function insertRenewVerifyLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  sessionId: string,
) {
  const { error } = await supabase.from("user_operation_logs").insert({
    user_id: userId,
    event_name: "renew_status_polled",
    page_path: "/renew-cloud",
    metadata: {
      sessionId,
    },
    occurred_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }
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

    const lastRenewVerifyAt = await getLastRenewVerifyAt(supabase, user.id);
    const now = Date.now();

    if (lastRenewVerifyAt) {
      const elapsedMs = now - lastRenewVerifyAt.getTime();

      if (elapsedMs < RENEW_VERIFY_MIN_INTERVAL_MS) {
        return NextResponse.json(
          {
            ok: true,
            processed: false,
            status: "rate_limited",
            retryAfterMs: RENEW_VERIFY_MIN_INTERVAL_MS - elapsedMs,
          },
          { status: 200 },
        );
      }
    }

    const order = await getOrderBySessionId(sessionId);

    await insertRenewVerifyLog(supabase, user.id, sessionId);

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

    if (order.order_kind !== "renew_cloud") {
      return NextResponse.json(
        {
          ok: false,
          error: "This payment session is not a cloud renewal order.",
        },
        { status: 400 },
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

    if (order.status === "failed") {
      return NextResponse.json(
        {
          ok: false,
          processed: false,
          status: order.status,
          error: order.error || "Cloud renewal failed.",
          storeId: order.store_id,
          renewId: order.renew_id,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      processed: order.status === "processed",
      status: order.status,
      storeId: order.store_id,
      renewId: order.renew_id,
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