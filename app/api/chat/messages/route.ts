import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SendMessageBody = {
  conversationId?: string;
  guestSessionId?: string;
  body?: string;
};

async function resolveConversation(
  conversationId: string,
  guestSessionId: string
) {
  const authClient = await createServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  const supabase = createAdminClient();

  const { data: conversation, error } = await supabase
    .from("support_conversations")
    .select("id, guest_session_id, user_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!conversation) {
    return {
      supabase,
      conversation: null,
    };
  }

  const guestMatched = conversation.guest_session_id === guestSessionId;
  const userMatched = !!user?.id && conversation.user_id === user.id;

  if (!guestMatched && !userMatched) {
    return {
      supabase,
      conversation: null,
    };
  }

  return {
    supabase,
    conversation,
  };
}

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() || "";
    const guestSessionId = request.nextUrl.searchParams.get("guestSessionId")?.trim() || "";

    if (!conversationId || !guestSessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "conversationId and guestSessionId are required.",
        },
        { status: 400 }
      );
    }

    const { supabase, conversation } = await resolveConversation(conversationId, guestSessionId);

    if (!conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conversation not found or access denied.",
        },
        { status: 403 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("support_messages")
      .select("id, sender_role, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      throw messagesError;
    }

    const now = new Date().toISOString();

    const { error: markReadError } = await supabase
      .from("support_messages")
      .update({
        read_by_user_at: now,
      })
      .eq("conversation_id", conversationId)
      .eq("sender_role", "admin")
      .is("read_by_user_at", null);

    if (markReadError) {
      throw markReadError;
    }

    const { error: resetUnreadError } = await supabase
      .from("support_conversations")
      .update({
        user_unread_count: 0,
        updated_at: now,
      })
      .eq("id", conversationId);

    if (resetUnreadError) {
      throw resetUnreadError;
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
        error: error instanceof Error ? error.message : "Failed to load messages.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendMessageBody;

    const conversationId = body.conversationId?.trim() || "";
    const guestSessionId = body.guestSessionId?.trim() || "";
    const messageBody = body.body?.trim() || "";

    if (!conversationId || !guestSessionId || !messageBody) {
      return NextResponse.json(
        {
          ok: false,
          error: "conversationId, guestSessionId and body are required.",
        },
        { status: 400 }
      );
    }

    const { supabase, conversation } = await resolveConversation(conversationId, guestSessionId);

    if (!conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conversation not found or access denied.",
        },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    const { data: currentConversation, error: currentConversationError } = await supabase
      .from("support_conversations")
      .select("admin_unread_count")
      .eq("id", conversationId)
      .single();

    if (currentConversationError) {
      throw currentConversationError;
    }

    const { error: insertError } = await supabase
      .from("support_messages")
      .insert({
        conversation_id: conversationId,
        sender_role: "user",
        body: messageBody,
        created_at: now,
      });

    if (insertError) {
      throw insertError;
    }

    const { error: updateConversationError } = await supabase
      .from("support_conversations")
      .update({
        last_message_preview: messageBody.slice(0, 160),
        last_message_at: now,
        admin_unread_count: (currentConversation.admin_unread_count || 0) + 1,
        updated_at: now,
      })
      .eq("id", conversationId);

    if (updateConversationError) {
      throw updateConversationError;
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to send message.",
      },
      { status: 500 }
    );
  }
}