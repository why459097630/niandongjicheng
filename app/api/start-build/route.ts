import { NextRequest, NextResponse } from "next/server";
import { startBuild } from "@/lib/build/startBuild";
import { BuildRequest } from "@/lib/build/types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<BuildRequest> & {
      adminName?: string;
      adminPassword?: string;
    };

    const payload: BuildRequest & {
      adminName?: string;
      adminPassword?: string;
    } = {
      appName: body.appName || "",
      module: body.module || "feature-showcase",
      uiPack: body.uiPack || "ui-pack-showcase-greenpink",
      plan: body.plan || "pro",
      iconUrl: body.iconUrl || null,
      adminName: body.adminName || "",
      adminPassword: body.adminPassword || "",
    };

    const result = startBuild(payload);

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to start build.",
      },
      { status: 500 },
    );
  }
}
