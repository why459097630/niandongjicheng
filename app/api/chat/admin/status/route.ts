import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

type StatusBody = {
  conversationId?: string;
  status?: "open" | "closed";
};

export async function POST(request: Request) {
  try {
    const adminCheck = await assertAdminAccess();

    if (!adminCheck.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: adminCheck.error,
        },
        { status: adminCheck.status }
      );
    }

    const body = (await request.json()) as StatusBody;
    const conversationId = body.conversationId?.trim() || "";
    const status = body.status;

    if (!conversationId || (status !== "open" && status !== "closed")) {
      return NextResponse.json(
        {
          ok: false,
          error: "conversationId and valid status are required.",
        },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("support_conversations")
      .update({
        status,
        updated_at: now,
      })
      .eq("id", conversationId)
      .select(
        "id, guest_session_id, user_email, user_name, source_path, latest_source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
      )
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      conversation: {
        id: data.id,
        guestSessionId: data.guest_session_id,
        userEmail: data.user_email,
        userName: data.user_name,
        sourcePath: data.latest_source_path || data.source_path,
        status: data.status,
        lastMessagePreview: data.last_message_preview,
        lastMessageAt: data.last_message_at,
        adminUnreadCount: data.admin_unread_count,
        userUnreadCount: data.user_unread_count,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to update conversation status.",
      },
      { status: 500 }
    );
  }
}