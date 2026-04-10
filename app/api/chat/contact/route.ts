import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ContactBody = {
  conversationId?: string;
  guestSessionId?: string;
  userEmail?: string | null;
  userName?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ContactBody;

    const conversationId = body.conversationId?.trim() || "";
    const guestSessionId = body.guestSessionId?.trim() || "";
    const userEmail = body.userEmail?.trim() || null;
    const userName = body.userName?.trim() || null;

    if (!conversationId && !guestSessionId) {
      return NextResponse.json(
        {
          ok: false,
          error: "conversationId or guestSessionId is required.",
        },
        { status: 400 }
      );
    }

    const authClient = await createServerClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();

    const supabase = createAdminClient();

    let query = supabase
      .from("support_conversations")
      .select("id, guest_session_id, user_id")
      .limit(1);

    if (conversationId) {
      query = query.eq("id", conversationId);
    } else {
      query = query.eq("guest_session_id", guestSessionId);
    }

    const { data: conversation, error: conversationError } = await query.maybeSingle();

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

    const guestMatched = !!guestSessionId && conversation.guest_session_id === guestSessionId;
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

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("support_conversations")
      .update({
        user_id: user?.id || null,
        user_email: user?.email || userEmail,
        user_name: userName,
        updated_at: now,
      })
      .eq("id", conversation.id);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to update contact info.",
      },
      { status: 500 }
    );
  }
}