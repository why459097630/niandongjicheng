import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { finalizeFirebaseAllocationDeletion } from "@/lib/firebase/projectPool";

export const runtime = "nodejs";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function isAuthorized(request: NextRequest): boolean {
  const headerSecret = (request.headers.get("x-api-secret") || "").trim();
  const allowedSecret =
    (process.env.API_SECRET || "").trim() ||
    (process.env.X_API_SECRET || "").trim();

  return !!allowedSecret && headerSecret === allowedSecret;
}

function getWebSupabase() {
  return createSupabaseClient(
    getRequiredEnv("WEB_SUPABASE_URL"),
    getRequiredEnv("WEB_SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as {
      storeId?: string;
    };

    const storeId = String(body.storeId || "").trim();

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "storeId is required.",
        },
        { status: 400 },
      );
    }

    const webSupabase = getWebSupabase();

    await finalizeFirebaseAllocationDeletion(webSupabase, storeId);

    return NextResponse.json({
      ok: true,
      storeId,
    });
  } catch (error) {
    console.error("NDJC firebase mark-delete-complete error", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to finalize firebase delete callback.",
      },
      { status: 500 },
    );
  }
}