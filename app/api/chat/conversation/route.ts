import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
    const guestSessionId = request.nextUrl.searchParams.get("guestSessionId")?.trim() || "";

    if (!guestSessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "guestSessionId is required.",
        },
        { status: 400 }
      );
    }

    const authClient = await createServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    const supabase = createAdminClient();

    const { data: conversation, error } = await supabase
      .from("support_conversations")
      .select(
        "id, guest_session_id, user_id, user_email, user_name, source_path, latest_source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
      )
      .eq("guest_session_id", guestSessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!conversation) {
      return NextResponse.json({
        ok: true,
        conversation: null,
      });
    }

    const guestMatched = conversation.guest_session_id === guestSessionId;
    const userMatched = !!user?.id && conversation.user_id === user.id;

    if (!guestMatched && !userMatched) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conversation not found or access denied.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      conversation: {
        id: conversation.id,
        guestSessionId: conversation.guest_session_id,
        userEmail: conversation.user_email,
        userName: conversation.user_name,
        sourcePath: conversation.latest_source_path || conversation.source_path,
        status: conversation.status,
        lastMessagePreview: conversation.last_message_preview,
        lastMessageAt: conversation.last_message_at,
        adminUnreadCount: conversation.admin_unread_count,
        userUnreadCount: conversation.user_unread_count,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load conversation summary.",
      },
      { status: 500 }
    );
  }
}