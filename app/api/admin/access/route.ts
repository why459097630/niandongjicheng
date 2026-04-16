import { NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

export async function GET() {
  try {
    const adminCheck = await assertAdminAccess();

    if (!adminCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          isAdmin: false,
          error: adminCheck.error,
        },
        { status: adminCheck.status },
      );
    }

    return NextResponse.json({
      ok: true,
      isAdmin: true,
      email: adminCheck.user?.email || null,
      userId: adminCheck.user?.id || null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        isAdmin: false,
        error: error instanceof Error ? error.message : "Failed to check admin access.",
      },
      { status: 500 },
    );
  }
}