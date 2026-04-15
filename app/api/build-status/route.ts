import { NextRequest, NextResponse } from "next/server";
import { getBuildStatus } from "@/lib/build/getBuildStatus";
import { createClient } from "@/lib/supabase/server";
import { insertOperationLogOnce, syncAuthUserProfile } from "@/lib/build/storage";
import { runAutoCompensation } from "@/lib/stripe/compensation";

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

    const paid = searchParams.get("paid") === "1";

    if (paid) {
      try {
        await runAutoCompensation(20);
      } catch (compensationError) {
        console.error("NDJC build-status: failed to run auto compensation", compensationError);
      }
    }

    const result = await getBuildStatus(supabase, runId, {
      isPaidFlow: paid,
      requestStartTime: Number(searchParams.get("t") || Date.now()),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 404 });
    }

    if (event === "poll") {
      try {
        await insertOperationLogOnce(
          supabase,
          {
            userId: user.id,
            runId,
            eventName: "build_status_polled",
            pagePath: "/generating",
            metadata: {
              source: "generating",
            },
          },
          { dedupeSeconds: 120 },
        );
      } catch (logError) {
        console.error("NDJC build-status: failed to write build_status_polled log", logError);
      }
    }

    if (event === "result_opened") {
      try {
        await insertOperationLogOnce(
          supabase,
          {
            userId: user.id,
            runId,
            eventName: "result_opened",
            pagePath: "/result",
            metadata: {
              source: "result",
            },
          },
          { dedupeSeconds: 30 },
        );
      } catch (logError) {
        console.error("NDJC build-status: failed to write result_opened log", logError);
      }
    }

    if (wantsDownload) {
      const source = event === "history_download" ? "history" : "result";
      const pagePath = event === "history_download" ? "/history" : "/result";

      try {
        await insertOperationLogOnce(
          supabase,
          {
            userId: user.id,
            runId,
            eventName: "download_clicked",
            pagePath,
            metadata: {
              source,
            },
          },
          { dedupeSeconds: 5 },
        );
      } catch (logError) {
        console.error("NDJC build-status: failed to write download_clicked log", logError);
      }

      if (result.downloadUrl) {
        const redirectUrl = /^https?:\/\//i.test(result.downloadUrl)
          ? result.downloadUrl
          : new URL(result.downloadUrl, request.url).toString();

        return NextResponse.redirect(redirectUrl, { status: 302 });
      }

      try {
        await insertOperationLogOnce(
          supabase,
          {
            userId: user.id,
            runId,
            eventName: "download_failed",
            pagePath,
            metadata: {
              source,
              reason: "missing_download_url",
            },
          },
          { dedupeSeconds: 30 },
        );
      } catch (logError) {
        console.error("NDJC build-status: failed to write download_failed log", logError);
      }

      return new NextResponse(
        `NDJC build package is not ready\nrunId=${result.runId}\nappName=${result.appName || ""}\nmodule=${result.moduleName || ""}\nuiPack=${result.uiPackName || ""}\nplan=${result.plan || ""}\nstoreId=${result.storeId || ""}\n`,
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
