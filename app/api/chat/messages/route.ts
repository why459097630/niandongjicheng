import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SendMessageBody = {
  conversationId?: string;
  guestSessionId?: string;
  body?: string;
};

type ConversationRow = {
  id: string;
  guest_session_id: string;
  user_id: string | null;
};

async function resolveConversation(conversationId: string, guestSessionId: string) {
  const authClient = await createServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  const supabase = createAdminClient();

  const { data: conversation, error } = await supabase
    .from("support_conversations")
    .select("id, guest_session_id, user_id")
    .eq("id", conversationId)
    .maybeSingle<ConversationRow>();

  if (error) {
    throw error;
  }

  if (!conversation) {
    return {
      supabase,
      conversation: null,
      user,
    };
  }

  const guestMatched = conversation.guest_session_id === guestSessionId;
  const userMatched = !!user?.id && conversation.user_id === user.id;

  if (!guestMatched && !userMatched) {
    return {
      supabase,
      conversation: null,
      user,
    };
  }

  return {
    supabase,
    conversation,
    user,
  };
}

export async function GET(request: NextRequest) {
  try {
    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() || "";
    const guestSessionId = request.nextUrl.searchParams.get("guestSessionId")?.trim() || "";
    const shouldMarkRead = request.nextUrl.searchParams.get("markRead") === "1";

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
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (messagesError) {
      throw messagesError;
    }

    if (shouldMarkRead) {
      const { error: markReadError } = await supabase.rpc("support_mark_user_read", {
        p_conversation_id: conversation.id,
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

    const { data: latestUserMessage, error: latestError } = await supabase
      .from("support_messages")
      .select("body, created_at")
      .eq("conversation_id", conversationId)
      .eq("sender_role", "user")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      throw latestError;
    }

    if (latestUserMessage) {
      const latestAt = new Date(latestUserMessage.created_at).getTime();
      const nowAt = Date.now();

      if (
        latestUserMessage.body === messageBody &&
        Number.isFinite(latestAt) &&
        nowAt - latestAt < 8000
      ) {
        return NextResponse.json({
          ok: true,
          duplicateSkipped: true,
        });
      }
    }

    const { error: sendError } = await supabase.rpc("support_send_user_message", {
      p_conversation_id: conversation.id,
      p_body: messageBody,
    });

    if (sendError) {
      throw sendError;
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