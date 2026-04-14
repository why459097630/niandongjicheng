import { NextRequest, NextResponse } from "next/server";
import { runAutoCompensation } from "@/lib/stripe/compensation";

export const runtime = "nodejs";

function getAllowedSecret(): string {
  return (
    (process.env.CRON_SECRET || "").trim() ||
    (process.env.STRIPE_COMPENSATION_CRON_SECRET || "").trim()
  );
}

function isAuthorized(request: NextRequest): boolean {
  const allowedSecret = getAllowedSecret();

  if (!allowedSecret) {
    return false;
  }

  const authHeader = (request.headers.get("authorization") || "").trim();
  const expectedAuth = `Bearer ${allowedSecret}`;

  return authHeader === expectedAuth;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const result = await runAutoCompensation(20);

    return NextResponse.json(result);
  } catch (error) {
    console.error("NDJC auto compensation error", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Auto compensation failed.",
      },
      { status: 500 },
    );
  }
}