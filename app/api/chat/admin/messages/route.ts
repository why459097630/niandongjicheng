import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
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

    const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim() || "";

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
        read_by_admin_at: now,
      })
      .eq("conversation_id", conversationId)
      .eq("sender_role", "user")
      .is("read_by_admin_at", null);

    if (markReadError) {
      throw markReadError;
    }

    const { error: resetUnreadError } = await supabase
      .from("support_conversations")
      .update({
        admin_unread_count: 0,
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
        error: error instanceof Error ? error.message : "Failed to load admin chat messages.",
      },
      { status: 500 }
    );
  }
}