import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ReplyBody = {
  conversationId?: string;
  body?: string;
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

    const body = (await request.json()) as ReplyBody;

    const conversationId = body.conversationId?.trim() || "";
    const messageBody = body.body?.trim() || "";

    if (!conversationId || !messageBody) {
      return NextResponse.json(
        {
          ok: false,
          error: "conversationId and body are required.",
        },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const now = new Date().toISOString();

    const { data: currentConversation, error: currentConversationError } = await supabase
      .from("support_conversations")
      .select("user_unread_count")
      .eq("id", conversationId)
      .single();

    if (currentConversationError) {
      throw currentConversationError;
    }

    const { error: insertError } = await supabase
      .from("support_messages")
      .insert({
        conversation_id: conversationId,
        sender_role: "admin",
        body: messageBody,
        admin_user_id: user.id,
        created_at: now,
      });

    if (insertError) {
      throw insertError;
    }

    const { error: updateConversationError } = await supabase
      .from("support_conversations")
      .update({
        status: "open",
        last_message_preview: messageBody.slice(0, 160),
        last_message_at: now,
        user_unread_count: (currentConversation.user_unread_count || 0) + 1,
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
        error: error instanceof Error ? error.message : "Failed to send admin reply.",
      },
      { status: 500 }
    );
  }
}