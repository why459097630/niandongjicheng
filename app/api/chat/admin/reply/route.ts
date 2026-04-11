import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

type ReplyBody = {
  conversationId?: string;
  body?: string;
};

export async function POST(request: Request) {
  try {
    const adminCheck = await assertAdminAccess();

    if (!adminCheck.ok || !adminCheck.user) {
      return NextResponse.json(
        {
          ok: false,
          error: adminCheck.error,
        },
        { status: adminCheck.status }
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

    if (messageBody.length > 2000) {
      return NextResponse.json(
        {
          ok: false,
          error: "Message is too long.",
        },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { data: conversation, error: conversationError } = await supabase
      .from("support_conversations")
      .select("id, status")
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

    if (conversation.status === "closed") {
      return NextResponse.json(
        {
          ok: false,
          error: "This conversation is closed.",
        },
        { status: 409 }
      );
    }

    const { data: latestAdminMessage, error: latestError } = await supabase
      .from("support_messages")
      .select("body, created_at")
      .eq("conversation_id", conversationId)
      .eq("sender_role", "admin")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      throw latestError;
    }

    if (latestAdminMessage) {
      const latestAt = new Date(latestAdminMessage.created_at).getTime();
      const nowAt = Date.now();

      if (
        latestAdminMessage.body === messageBody &&
        Number.isFinite(latestAt) &&
        nowAt - latestAt < 8000
      ) {
        return NextResponse.json({
          ok: true,
          duplicateSkipped: true,
        });
      }
    }

    const { error: sendError } = await supabase.rpc("support_send_admin_message", {
      p_conversation_id: conversationId,
      p_body: messageBody,
      p_admin_user_id: adminCheck.user.id,
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
        error: error instanceof Error ? error.message : "Failed to send admin reply.",
      },
      { status: 500 }
    );
  }
}