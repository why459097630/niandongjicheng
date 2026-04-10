import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Body = {
  sessionId?: string;
  pagePath?: string | null;
  referrer?: string | null;
  queryString?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const body = (await request.json()) as Body;
    const sessionId = (body.sessionId || "").trim();
    const pagePath = (body.pagePath || "").trim();

    if (!sessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "sessionId is required.",
        },
        { status: 400 },
      );
    }

    if (!pagePath) {
      return NextResponse.json(
        {
          ok: false,
          error: "pagePath is required.",
        },
        { status: 400 },
      );
    }

    const { error } = await supabase.from("page_view_logs").insert({
      user_id: user?.id ?? null,
      session_id: sessionId,
      page_path: pagePath,
      referrer: body.referrer ?? null,
      query_string: body.queryString ?? null,
    });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to track page view.",
      },
      { status: 500 },
    );
  }
}