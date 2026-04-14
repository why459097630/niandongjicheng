import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function getServiceSupabase() {
  const supabaseUrl = getRequiredEnv("WEB_SUPABASE_URL");
  const supabaseSecretKey = getRequiredEnv("WEB_SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET() {
  try {
    const adminCheck = await assertAdminAccess();

    if (!adminCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: adminCheck.error,
        },
        { status: adminCheck.status },
      );
    }

    const supabase = getServiceSupabase();

    const { data, error } = await supabase
      .from("web_stripe_orders")
      .select(
        [
          "id",
          "order_kind",
          "user_id",
          "run_id",
          "store_id",
          "renew_id",
          "stripe_session_id",
          "stripe_payment_intent_id",
          "status",
          "amount_total",
          "currency",
          "paid_at",
          "failed_at",
          "processed_at",
          "retry_count",
          "manual_retry_count",
          "next_retry_at",
          "compensation_status",
          "compensation_note",
          "last_retry_at",
          "admin_notified_at",
          "manual_review_required_at",
          "refunded_at",
          "refund_reason",
          "stripe_refund_id",
          "renewal_applied_at",
          "build_started_at",
          "error",
          "created_at",
          "updated_at",
        ].join(","),
      )
      .in("status", ["failed", "manual_review_required", "refund_pending", "refunded"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      items: data || [],
    });
  } catch (error) {
    console.error("NDJC admin orders list error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load admin orders.",
      },
      { status: 500 },
    );
  }
}