import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type BootstrapBody = {
  guestSessionId?: string;
  userEmail?: string | null;
  userName?: string | null;
  sourcePath?: string | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as BootstrapBody;

    const guestSessionId = body.guestSessionId?.trim() || "";
    const sourcePath = body.sourcePath?.trim() || null;
    const submittedEmail = body.userEmail?.trim() || null;
    const submittedName = body.userName?.trim() || null;

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

    const { data: existingConversation, error: selectError } = await supabase
      .from("support_conversations")
      .select("id, guest_session_id, user_email, user_name, source_path")
      .eq("guest_session_id", guestSessionId)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    const userEmail = user?.email || submittedEmail;
    const userName = submittedName;
    const now = new Date().toISOString();

    if (existingConversation) {
      const { error: updateError } = await supabase
        .from("support_conversations")
        .update({
          user_id: user?.id || null,
          user_email: userEmail,
          user_name: userName,
          source_path: sourcePath,
          updated_at: now,
        })
        .eq("id", existingConversation.id);

      if (updateError) {
        throw updateError;
      }

      return NextResponse.json({
        ok: true,
        conversation: {
          id: existingConversation.id,
          guestSessionId,
          userEmail,
          userName,
          sourcePath,
        },
      });
    }

    const { data: insertedConversation, error: insertError } = await supabase
      .from("support_conversations")
      .insert({
        guest_session_id: guestSessionId,
        user_id: user?.id || null,
        user_email: userEmail,
        user_name: userName,
        source_path: sourcePath,
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
        guestSessionId,
        userEmail,
        userName,
        sourcePath,
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