import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

export async function GET(request: NextRequest) {
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

    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() || "";
    const shouldMarkRead = request.nextUrl.searchParams.get("markRead") === "1";

    if (!conversationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "conversationId is required.",
        },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: conversation, error: conversationError } = await supabase
      .from("support_conversations")
      .select("id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError) {
      throw conversationError;
    }

    if (!conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conversation not found.",
        },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("support_messages")
      .select("id, sender_role, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (messagesError) {
      throw messagesError;
    }

    if (shouldMarkRead) {
      const { error: markReadError } = await supabase.rpc("support_mark_admin_read", {
        p_conversation_id: conversationId,
      });

      if (markReadError) {
        throw markReadError;
      }
    }

    return NextResponse.json({
      ok: true,
      messages: (messages || []).map((item) => ({
        id: item.id,
        senderRole: item.sender_role,
        body: item.body,
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load admin chat messages.",
      },
      { status: 500 }
    );
  }
}