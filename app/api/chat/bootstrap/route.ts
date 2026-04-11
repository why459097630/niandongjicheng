import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createGuestAccessToken } from "@/lib/chat/guestAccess";

type BootstrapBody = {
  guestSessionId?: string;
  userEmail?: string | null;
  userName?: string | null;
  sourcePath?: string | null;
};

type ConversationRow = {
  id: string;
  guest_session_id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  source_path: string | null;
  latest_source_path: string | null;
  last_message_at: string;
};

function createGuestSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(value: string | null) {
  const next = value?.trim() || "";
  return next || null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BootstrapBody;

    const guestSessionId = body.guestSessionId?.trim() || "";
    const sourcePath = body.sourcePath?.trim() || null;
    const submittedEmail = body.userEmail?.trim() || null;
    const submittedName = normalizeName(body.userName || null);

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
    const userEmail = user?.email || submittedEmail;
    const userName = submittedName || (userEmail ? userEmail.split("@")[0] || null : null);
    const now = new Date().toISOString();

    let userConversation: ConversationRow | null = null;

    if (user?.id) {
      const { data, error } = await supabase
        .from("support_conversations")
        .select(
          "id, guest_session_id, user_id, user_email, user_name, source_path, latest_source_path, last_message_at"
        )
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }

      userConversation = data;
    }

    if (userConversation) {
      const { error: updateError } = await supabase
        .from("support_conversations")
        .update({
          user_email: userEmail || userConversation.user_email,
          user_name: userConversation.user_name || userName,
          latest_source_path: sourcePath || userConversation.latest_source_path,
          updated_at: now,
        })
        .eq("id", userConversation.id);

      if (updateError) {
        throw updateError;
      }

      return NextResponse.json({
        ok: true,
        conversation: {
          id: userConversation.id,
          guestSessionId: userConversation.guest_session_id,
          userEmail: userEmail || userConversation.user_email,
          userName: userConversation.user_name || userName,
          sourcePath:
            sourcePath || userConversation.latest_source_path || userConversation.source_path,
          accessToken: createGuestAccessToken(
            userConversation.id,
            userConversation.guest_session_id
          ),
        },
      });
    }

    const { data: guestCandidates, error: guestError } = await supabase
      .from("support_conversations")
      .select(
        "id, guest_session_id, user_id, user_email, user_name, source_path, latest_source_path, last_message_at"
      )
      .eq("guest_session_id", guestSessionId)
      .order("last_message_at", { ascending: false })
      .limit(20);

    if (guestError) {
      throw guestError;
    }

    const reusableGuestConversation =
      (guestCandidates || []).find((item) => !item.user_id || item.user_id === user?.id) || null;

    if (reusableGuestConversation) {
      const { error: updateError } = await supabase
        .from("support_conversations")
        .update({
          user_id: reusableGuestConversation.user_id || user?.id || null,
          user_email: userEmail || reusableGuestConversation.user_email,
          user_name: reusableGuestConversation.user_name || userName,
          latest_source_path: sourcePath || reusableGuestConversation.latest_source_path,
          updated_at: now,
        })
        .eq("id", reusableGuestConversation.id);

      if (updateError) {
        throw updateError;
      }

      return NextResponse.json({
        ok: true,
        conversation: {
          id: reusableGuestConversation.id,
          guestSessionId: reusableGuestConversation.guest_session_id,
          userEmail: userEmail || reusableGuestConversation.user_email,
          userName: reusableGuestConversation.user_name || userName,
          sourcePath:
            sourcePath ||
            reusableGuestConversation.latest_source_path ||
            reusableGuestConversation.source_path,
          accessToken: createGuestAccessToken(
            reusableGuestConversation.id,
            reusableGuestConversation.guest_session_id
          ),
        },
      });
    }

    const hasGuestConflict = (guestCandidates || []).some(
      (item) => !!item.user_id && item.user_id !== user?.id
    );

    const nextGuestSessionId = hasGuestConflict ? createGuestSessionId() : guestSessionId;

    const { data: insertedConversation, error: insertError } = await supabase
      .from("support_conversations")
      .insert({
        guest_session_id: nextGuestSessionId,
        user_id: user?.id || null,
        user_email: userEmail,
        user_name: userName,
        source_path: sourcePath,
        latest_source_path: sourcePath,
        status: "open",
        last_message_preview: null,
        last_message_at: now,
        admin_unread_count: 0,
        user_unread_count: 0,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      ok: true,
      conversation: {
        id: insertedConversation.id,
        guestSessionId: nextGuestSessionId,
        userEmail,
        userName,
        sourcePath,
        accessToken: createGuestAccessToken(insertedConversation.id, nextGuestSessionId),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to bootstrap chat.",
      },
      { status: 500 }
    );
  }
}