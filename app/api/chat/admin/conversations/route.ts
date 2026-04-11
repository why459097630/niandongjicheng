import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdminAccess } from "@/lib/chat/assertAdminAccess";

type ConversationRow = {
  id: string;
  guest_session_id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  source_path: string | null;
  latest_source_path: string | null;
  status: "open" | "closed";
  last_message_preview: string | null;
  last_message_at: string;
  admin_unread_count: number;
  user_unread_count: number;
  created_at: string;
  updated_at: string;
};

function dedupeConversations(rows: ConversationRow[]) {
  const map = new Map<string, ConversationRow>();

  for (const item of rows) {
    const key = item.user_id
      ? `user:${item.user_id}`
      : item.guest_session_id
        ? `guest:${item.guest_session_id}`
        : `id:${item.id}`;

    const previous = map.get(key);

    if (!previous) {
      map.set(key, item);
      continue;
    }

    const previousTime = new Date(previous.last_message_at || previous.updated_at).getTime();
    const currentTime = new Date(item.last_message_at || item.updated_at).getTime();

    if (currentTime >= previousTime) {
      map.set(key, item);
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if ((b.admin_unread_count || 0) !== (a.admin_unread_count || 0)) {
      return (b.admin_unread_count || 0) - (a.admin_unread_count || 0);
    }

    return (
      new Date(b.last_message_at || b.updated_at).getTime() -
      new Date(a.last_message_at || a.updated_at).getTime()
    );
  });
}

function normalizeLimit(raw: string | null, fallback: number, max: number) {
  const parsed = Number(raw || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

export async function GET(request: NextRequest) {
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

    const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"), 100, 100);

    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("support_conversations")
      .select(
        "id, guest_session_id, user_id, user_email, user_name, source_path, latest_source_path, status, last_message_preview, last_message_at, admin_unread_count, user_unread_count, created_at, updated_at"
      )
      .order("last_message_at", { ascending: false })
      .limit(limit * 2);

    if (error) {
      throw error;
    }

    const normalized = dedupeConversations((data || []) as ConversationRow[]).slice(0, limit);

    return NextResponse.json({
      ok: true,
      conversations: normalized.map((item) => ({
        id: item.id,
        guestSessionId: item.guest_session_id,
        userEmail: item.user_email,
        userName: item.user_name,
        sourcePath: item.latest_source_path || item.source_path,
        status: item.status,
        lastMessagePreview: item.last_message_preview,
        lastMessageAt: item.last_message_at,
        adminUnreadCount: item.admin_unread_count,
        userUnreadCount: item.user_unread_count,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      hasMore: (data || []).length > normalized.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load conversations.",
      },
      { status: 500 }
    );
  }
}