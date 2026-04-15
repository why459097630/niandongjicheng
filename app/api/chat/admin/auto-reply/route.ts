import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";
import { getSupportAutoReplySettings } from "@/lib/chat/autoReply";

type AutoReplyBody = {
  enabled?: boolean;
  replyText?: string;
  delaySeconds?: number;
};

const DEFAULT_AUTO_REPLY_TEXT = "您好，我们已收到您的消息，会尽快回复您。";
const MAX_AUTO_REPLY_LENGTH = 2000;

export async function GET() {
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

    const supabase = createAdminClient();
    const settings = await getSupportAutoReplySettings(supabase);

    return NextResponse.json({
      ok: true,
      settings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load auto reply settings.",
      },
      { status: 500 }
    );
  }
}

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

    const body = (await request.json()) as AutoReplyBody;

    const enabled = !!body.enabled;
    const replyText = (body.replyText || "").trim();
    const rawDelay = Number(body.delaySeconds);
    const delaySeconds = Number.isFinite(rawDelay) ? Math.max(0, Math.min(300, Math.floor(rawDelay))) : 10;

    if (!replyText) {
      return NextResponse.json(
        {
          ok: false,
          error: "replyText is required.",
        },
        { status: 400 }
      );
    }

    if (replyText.length > MAX_AUTO_REPLY_LENGTH) {
      return NextResponse.json(
        {
          ok: false,
          error: `replyText is too long. max ${MAX_AUTO_REPLY_LENGTH}`,
        },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    const { error } = await supabase
      .from("support_auto_reply_settings")
      .upsert(
        {
          id: true,
          enabled,
          reply_text: replyText || DEFAULT_AUTO_REPLY_TEXT,
          delay_seconds: delaySeconds,
          updated_by: adminCheck.user.id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "id",
        }
      );

    if (error) {
      throw error;
    }

    const settings = await getSupportAutoReplySettings(supabase);

    return NextResponse.json({
      ok: true,
      settings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to save auto reply settings.",
      },
      { status: 500 }
    );
  }
}