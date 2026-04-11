import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ConversationRow = {
  id: string;
  guest_session_id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  source_path: string | null;
  latest_source_path: string | null;
  status: "open" | "closed";
  last_message_preview: string | null;
  last_message_at: string;
  admin_unread_count: number;
  user_unread_count: number;
  created_at: string;
  updated_at: string;
};

function pickConversation(
  rows: ConversationRow[],
  guestSessionId: string,
  userId: string | null | undefined
) {
  if (userId) {
    const userOwned = rows.find((item) => item.user_id === userId);
    if (userOwned) {
      return userOwned;
    }
  }

  return (
    rows.find(
      (item) =>
        item.guest_session_id === guestSessionId && (!item.user_id || item.user_id === userId)
    ) || null
  );
}

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

    const { data: guestRows, error: guestError } = await supabase
      .from("support_conversations")
      .select(
        "id, guest_session_id, user_id, user_email, user_name, source_path, latest_source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
      )
      .eq("guest_session_id", guestSessionId)
      .order("last_message_at", { ascending: false })
      .limit(20);

    if (guestError) {
      throw guestError;
    }

    let conversation = pickConversation(guestRows || [], guestSessionId, user?.id);

    if (!conversation && user?.id) {
      const { data: userRows, error: userError } = await supabase
        .from("support_conversations")
        .select(
          "id, guest_session_id, user_id, user_email, user_name, source_path, latest_source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
        )
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .limit(1);

      if (userError) {
        throw userError;
      }

      conversation = (userRows || [])[0] || null;
    }

    if (!conversation) {
      return NextResponse.json({
        ok: true,
        conversation: null,
      });
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