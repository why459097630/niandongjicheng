import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type Body = {
  sessionId?: string;
  landingPath?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const frontendUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
    const frontendPublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || "";

    if (!frontendUrl || !frontendPublishableKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as Body;
    const sessionId = (body.sessionId || "").trim();

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "sessionId is required.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseClient(frontendUrl, frontendPublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const now = new Date().toISOString();

    const { data: existing, error: existingError } = await supabase
      .from("user_acquisition_logs")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("user_acquisition_logs")
        .update({
          landing_path: body.landingPath ?? null,
          referrer: body.referrer ?? null,
          utm_source: body.utmSource ?? null,
          utm_medium: body.utmMedium ?? null,
          utm_campaign: body.utmCampaign ?? null,
          last_seen_at: now,
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      return NextResponse.json({ ok: true });
    }

    const { error: insertError } = await supabase.from("user_acquisition_logs").insert({
      user_id: null,
      session_id: sessionId,
      landing_path: body.landingPath ?? null,
      referrer: body.referrer ?? null,
      utm_source: body.utmSource ?? null,
      utm_medium: body.utmMedium ?? null,
      utm_campaign: body.utmCampaign ?? null,
      first_seen_at: now,
      last_seen_at: now,
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to track acquisition.",
      },
      { status: 500 },
    );
  }
}