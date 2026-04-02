import { NextRequest, NextResponse } from "next/server";
import { getBuildStatus } from "@/lib/build/getBuildStatus";
import { createClient } from "@/lib/supabase/server";

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
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim() || "";
    const wantsDownload = searchParams.get("download") === "1";

    if (!runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing runId.",
        },
        { status: 400 },
      );
    }

    const result = await getBuildStatus(supabase, runId);

    if (!result.ok) {
      return NextResponse.json(result, { status: 404 });
    }

    if (wantsDownload) {
      if (result.downloadUrl) {
        return NextResponse.redirect(result.downloadUrl, { status: 302 });
      }

      return new NextResponse(
        `NDJC build package is not ready\nrunId=${result.runId}\nappName=${result.appName || ""}\nmodule=${result.moduleName || ""}\nuiPack=${result.uiPackName || ""}\nplan=${result.plan || ""}\nadminName=${result.adminName || ""}\nstoreId=${result.storeId || ""}\n`,
        {
          status: 409,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load build status.",
      },
      { status: 500 },
    );
  }
}
