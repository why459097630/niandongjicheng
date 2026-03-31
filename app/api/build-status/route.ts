import { NextRequest, NextResponse } from "next/server";
import { getBuildStatus } from "@/lib/build/getBuildStatus";
import { getBuildRecord } from "@/lib/build/storage";

export async function GET(request: NextRequest) {
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

  const result = getBuildStatus(runId);

  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }

  if (wantsDownload) {
    const record = getBuildRecord(runId);

    return new NextResponse(
      `NDJC mock build package\nrunId=${result.runId}\nappName=${result.appName}\nmodule=${result.moduleName}\nuiPack=${result.uiPackName}\nplan=${result.plan}\nadminName=${record?.adminName || ""}\nstoreId=${record?.storeId || ""}\n`,
      {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${runId}.zip"`,
        },
      },
    );
  }

  return NextResponse.json(result, { status: 200 });
}
