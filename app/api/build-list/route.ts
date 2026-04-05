import { NextRequest, NextResponse } from "next/server";
import { getBuildList } from "@/lib/build/getBuildList";
import { createClient } from "@/lib/supabase/server";
import { insertOperationLogOnce, syncAuthUserProfile } from "@/lib/build/storage";

export async function GET(request: NextRequest) {
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
          items: [],
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error("NDJC build-list: failed to sync profile", profileError);
    }

    const shouldLogOpen = request.nextUrl.searchParams.get("logOpen") === "1";

    if (shouldLogOpen) {
      try {
        await insertOperationLogOnce(
          supabase,
          {
            userId: user.id,
            eventName: "history_opened",
            pagePath: "/history",
            metadata: {
              source: "history_page",
            },
          },
          { dedupeSeconds: 30 },
        );
      } catch (logError) {
        console.error("NDJC build-list: failed to write history_opened log", logError);
      }
    }

    const result = await getBuildList(supabase, user.id);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        items: [],
        error: error instanceof Error ? error.message : "Failed to load build list.",
      },
      { status: 500 },
    );
  }
}
