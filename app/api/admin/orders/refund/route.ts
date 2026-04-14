import { NextRequest, NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";
import { refundStripeOrder } from "@/lib/stripe/compensation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const orderId = String(body?.orderId || "").trim();
    const reason = String(body?.reason || "Refund requested by admin.").trim();

    if (!orderId) {
      return NextResponse.json(
        {
          ok: false,
          error: "orderId is required.",
        },
        { status: 400 },
      );
    }

    const result = await refundStripeOrder(orderId, reason);

    return NextResponse.json(result);
  } catch (error) {
    console.error("NDJC admin refund order error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to refund order.",
      },
      { status: 500 },
    );
  }
}