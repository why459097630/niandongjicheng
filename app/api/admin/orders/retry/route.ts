import { NextRequest, NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";
import { processStripeOrderById } from "@/lib/stripe/compensation";

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

    if (!orderId) {
      return NextResponse.json(
        {
          ok: false,
          error: "orderId is required.",
        },
        { status: 400 },
      );
    }

    const result = await processStripeOrderById(orderId, "manual_retry");

    return NextResponse.json(result);
  } catch (error) {
    console.error("NDJC admin retry order error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to retry order.",
      },
      { status: 500 },
    );
  }
}