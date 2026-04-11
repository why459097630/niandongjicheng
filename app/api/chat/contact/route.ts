import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ContactBody = {
  conversationId?: string;
  guestSessionId?: string;
  userEmail?: string | null;
  userName?: string | null;
};

type ConversationRow = {
  id: string;
  guest_session_id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
};

function normalizeName(value: string | null) {
  const next = value?.trim() || "";
  return next || null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ContactBody;

    const conversationId = body.conversationId?.trim() || "";
    const guestSessionId = body.guestSessionId?.trim() || "";
    const submittedEmail = body.userEmail?.trim() || null;
    const submittedName = normalizeName(body.userName || null);

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

    let candidates: ConversationRow[] = [];

    if (conversationId) {
      const { data, error } = await supabase
        .from("support_conversations")
        .select("id, guest_session_id, user_id, user_email, user_name")
        .eq("id", conversationId)
        .limit(1);

      if (error) {
        throw error;
      }

      candidates = data || [];
    } else {
      const { data, error } = await supabase
        .from("support_conversations")
        .select("id, guest_session_id, user_id, user_email, user_name")
        .eq("guest_session_id", guestSessionId)
        .order("updated_at", { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      candidates = data || [];
    }

    const conversation =
      candidates.find((item) => {
        const guestMatched = !!guestSessionId && item.guest_session_id === guestSessionId;
        const userMatched = !!user?.id && item.user_id === user.id;

        if (user?.id) {
          return userMatched || (guestMatched && (!item.user_id || item.user_id === user.id));
        }

        return guestMatched && !item.user_id;
      }) || null;

    if (!conversation) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conversation not found or access denied.",
        },
        { status: 403 }
      );
    }

    if (conversation.user_id && user?.id && conversation.user_id !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "Conversation not found or access denied.",
        },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const nextUserId = conversation.user_id || user?.id || null;
    const nextUserEmail = user?.email || conversation.user_email || submittedEmail;
    const nextUserName =
      conversation.user_name ||
      submittedName ||
      (nextUserEmail ? nextUserEmail.split("@")[0] || null : null);

    const { error: updateError } = await supabase
      .from("support_conversations")
      .update({
        user_id: nextUserId,
        user_email: nextUserEmail,
        user_name: nextUserName,
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