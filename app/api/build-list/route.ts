import { NextResponse } from "next/server";
import { getBuildList } from "@/lib/build/getBuildList";

export async function GET() {
  try {
    const result = getBuildList();
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
