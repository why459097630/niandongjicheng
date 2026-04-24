import { NextRequest, NextResponse } from "next/server";
import { getBuildStatus } from "@/lib/build/getBuildStatus";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim() || "";

    if (!runId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing runId.",
        },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const result = await getBuildStatus(supabase, runId, {
      isPaidFlow: false,
      requestStartTime: Date.now(),
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "App download information was not found.",
        },
        { status: 404 },
      );
    }

    if (result.stage !== "success") {
      return NextResponse.json(
        {
          ok: false,
          error: "This app is not ready for download yet.",
        },
        { status: 409 },
      );
    }

    if (!result.publicApkUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "This app does not have a public APK download link.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        runId: result.runId,
        appName: result.appName || "Merchant App",
        publicApkUrl: result.publicApkUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load app download information.",
      },
      { status: 500 },
    );
  }
}