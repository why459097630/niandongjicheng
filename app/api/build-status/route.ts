import { NextRequest, NextResponse } from "next/server";
import { getBuildStatus } from "@/lib/build/getBuildStatus";
import { createClient } from "@/lib/supabase/server";
import { insertOperationLog, syncAuthUserProfile } from "@/lib/build/storage";

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

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error("NDJC build-status: failed to sync profile", profileError);
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim() || "";
    const wantsDownload = searchParams.get("download") === "1";
    const event = searchParams.get("event")?.trim() || "";

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

    if (event === "poll") {
      try {
        await insertOperationLog(supabase, {
          userId: user.id,
          runId,
          eventName: "build_status_polled",
          pagePath: "/generating",
          metadata: {},
        });
      } catch (logError) {
        console.error("NDJC build-status: failed to write build_status_polled log", logError);
      }
    }

    if (event === "result_opened") {
      try {
        await insertOperationLog(supabase, {
          userId: user.id,
          runId,
          eventName: "result_opened",
          pagePath: "/result",
          metadata: {},
        });
      } catch (logError) {
        console.error("NDJC build-status: failed to write result_opened log", logError);
      }
    }

    if (wantsDownload) {
      try {
        await insertOperationLog(supabase, {
          userId: user.id,
          runId,
          eventName: "download_clicked",
          pagePath: event === "history_download" ? "/history" : "/result",
          metadata: {
            source: event === "history_download" ? "history" : "result",
          },
        });
      } catch (logError) {
        console.error("NDJC build-status: failed to write download_clicked log", logError);
      }

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
