import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

export async function GET() {
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

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("support_conversations")
      .select(
        "id, guest_session_id, user_email, user_name, source_path, latest_source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
      )
      .order("admin_unread_count", { ascending: false })
      .order("last_message_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      conversations: (data || []).map((item) => ({
        id: item.id,
        guestSessionId: item.guest_session_id,
        userEmail: item.user_email,
        userName: item.user_name,
        sourcePath: item.latest_source_path || item.source_path,
        status: item.status,
        lastMessagePreview: item.last_message_preview,
        lastMessageAt: item.last_message_at,
        adminUnreadCount: item.admin_unread_count,
        userUnreadCount: item.user_unread_count,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load conversations.",
      },
      { status: 500 }
    );
  }
}