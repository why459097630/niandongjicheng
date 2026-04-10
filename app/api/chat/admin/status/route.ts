import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type StatusBody = {
  conversationId?: string;
  status?: "open" | "closed";
};

export async function POST(request: Request) {
  try {
    const authClient = await createServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized.",
        },
        { status: 401 }
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
        "id, guest_session_id, user_email, user_name, source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
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
        sourcePath: data.source_path,
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