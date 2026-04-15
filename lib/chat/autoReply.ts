import type { SupabaseClient } from "@supabase/supabase-js";

export type SupportAutoReplySettings = {
  enabled: boolean;
  replyText: string;
  delaySeconds: number;
  updatedAt: string | null;
};

type AutoReplySettingsRow = {
  id: boolean;
  enabled: boolean;
  reply_text: string;
  delay_seconds: number;
  updated_at: string | null;
};

type ConversationAutoReplyRow = {
  id: string;
  status: "open" | "closed";
  auto_reply_pending_message_id: string | null;
  auto_reply_pending_at: string | null;
  auto_reply_last_sent_for_message_id: string | null;
};

type MessageRow = {
  id: string;
  sender_role: "user" | "admin";
  body: string;
  created_at: string;
};

const DEFAULT_AUTO_REPLY_TEXT = "您好，我们已收到您的消息，会尽快回复您。";
const DEFAULT_AUTO_REPLY_DELAY_SECONDS = 10;

function normalizeReplyText(value: string | null | undefined) {
  const next = (value || "").trim();
  return next || DEFAULT_AUTO_REPLY_TEXT;
}

async function ensureSettingsRow(supabase: SupabaseClient<any, any, any>) {
  const { data, error } = await supabase
    .from("support_auto_reply_settings")
    .select("id, enabled, reply_text, delay_seconds, updated_at")
    .eq("id", true)
    .maybeSingle<AutoReplySettingsRow>();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("support_auto_reply_settings")
    .insert({
      id: true,
      enabled: false,
      reply_text: DEFAULT_AUTO_REPLY_TEXT,
      delay_seconds: DEFAULT_AUTO_REPLY_DELAY_SECONDS,
    })
    .select("id, enabled, reply_text, delay_seconds, updated_at")
    .single<AutoReplySettingsRow>();

  if (insertError) {
    throw insertError;
  }

  return inserted;
}

export async function getSupportAutoReplySettings(
  supabase: SupabaseClient<any, any, any>
): Promise<SupportAutoReplySettings> {
  const row = await ensureSettingsRow(supabase);

  return {
    enabled: !!row.enabled,
    replyText: normalizeReplyText(row.reply_text),
    delaySeconds:
      Number.isFinite(Number(row.delay_seconds)) && Number(row.delay_seconds) >= 0
        ? Math.min(300, Math.floor(Number(row.delay_seconds)))
        : DEFAULT_AUTO_REPLY_DELAY_SECONDS,
    updatedAt: row.updated_at || null,
  };
}

async function clearConversationPendingAutoReply(
  supabase: SupabaseClient<any, any, any>,
  conversationId: string
) {
  const { error } = await supabase
    .from("support_conversations")
    .update({
      auto_reply_pending_message_id: null,
      auto_reply_pending_at: null,
    })
    .eq("id", conversationId);

  if (error) {
    throw error;
  }
}

export async function scheduleConversationAutoReply(
  supabase: SupabaseClient<any, any, any>,
  conversationId: string,
  messageId: string
) {
  const settings = await getSupportAutoReplySettings(supabase);

  if (!settings.enabled || !settings.replyText.trim()) {
    await clearConversationPendingAutoReply(supabase, conversationId);
    return;
  }

  const pendingAt = new Date(Date.now() + settings.delaySeconds * 1000).toISOString();

  const { error } = await supabase
    .from("support_conversations")
    .update({
      auto_reply_pending_message_id: messageId,
      auto_reply_pending_at: pendingAt,
    })
    .eq("id", conversationId);

  if (error) {
    throw error;
  }
}

export async function cancelConversationAutoReply(
  supabase: SupabaseClient<any, any, any>,
  conversationId: string
) {
  const { error } = await supabase
    .from("support_conversations")
    .update({
      auto_reply_pending_message_id: null,
      auto_reply_pending_at: null,
    })
    .eq("id", conversationId);

  if (error) {
    throw error;
  }
}

export async function processConversationAutoReply(
  supabase: SupabaseClient<any, any, any>,
  conversationId: string
) {
  const settings = await getSupportAutoReplySettings(supabase);

  const { data: conversation, error: conversationError } = await supabase
    .from("support_conversations")
    .select(
      "id, status, auto_reply_pending_message_id, auto_reply_pending_at, auto_reply_last_sent_for_message_id"
    )
    .eq("id", conversationId)
    .maybeSingle<ConversationAutoReplyRow>();

  if (conversationError) {
    throw conversationError;
  }

  if (!conversation) {
    return false;
  }

  if (!settings.enabled || !settings.replyText.trim()) {
    await clearConversationPendingAutoReply(supabase, conversationId);
    return false;
  }

  if (conversation.status !== "open") {
    await clearConversationPendingAutoReply(supabase, conversationId);
    return false;
  }

  if (!conversation.auto_reply_pending_message_id || !conversation.auto_reply_pending_at) {
    return false;
  }

  const pendingAtMs = new Date(conversation.auto_reply_pending_at).getTime();

  if (!Number.isFinite(pendingAtMs) || pendingAtMs > Date.now()) {
    return false;
  }

  if (
    conversation.auto_reply_last_sent_for_message_id &&
    conversation.auto_reply_last_sent_for_message_id === conversation.auto_reply_pending_message_id
  ) {
    await clearConversationPendingAutoReply(supabase, conversationId);
    return false;
  }

  const { data: latestMessage, error: latestMessageError } = await supabase
    .from("support_messages")
    .select("id, sender_role, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<MessageRow>();

  if (latestMessageError) {
    throw latestMessageError;
  }

  if (!latestMessage) {
    await clearConversationPendingAutoReply(supabase, conversationId);
    return false;
  }

  if (
    latestMessage.id !== conversation.auto_reply_pending_message_id ||
    latestMessage.sender_role !== "user"
  ) {
    await clearConversationPendingAutoReply(supabase, conversationId);
    return false;
  }

  const { data: claimRow, error: claimError } = await supabase
    .from("support_conversations")
    .update({
      auto_reply_pending_message_id: null,
      auto_reply_pending_at: null,
      auto_reply_last_sent_for_message_id: conversation.auto_reply_pending_message_id,
    })
    .eq("id", conversationId)
    .eq("auto_reply_pending_message_id", conversation.auto_reply_pending_message_id)
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw claimError;
  }

  if (!claimRow) {
    return false;
  }

  const { error: sendError } = await supabase.rpc("support_send_admin_message", {
    p_conversation_id: conversationId,
    p_body: settings.replyText.trim(),
    p_admin_user_id: null,
  });

  if (sendError) {
    throw sendError;
  }

  return true;
}