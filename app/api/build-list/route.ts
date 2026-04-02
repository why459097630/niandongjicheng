import { NextResponse } from "next/server";
import { getBuildList } from "@/lib/build/getBuildList";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
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
