"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";

type ConversationItem = {
  id: string;
  guestSessionId: string;
  userEmail: string | null;
  userName: string | null;
  sourcePath: string | null;
  status: "open" | "closed";
  lastMessagePreview: string | null;
  lastMessageAt: string;
  adminUnreadCount: number;
  userUnreadCount: number;
  createdAt: string;
  updatedAt: string;
};

type ChatMessage = {
  id: string;
  senderRole: "user" | "admin";
  body: string;
  createdAt: string;
};

type ConversationsResponse = {
  ok: boolean;
  conversations?: ConversationItem[];
  error?: string;
};

type MessagesResponse = {
  ok: boolean;
  messages?: ChatMessage[];
  error?: string;
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function AdminChatPanel() {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const loadConversations = async (keepSelection = true) => {
    try {
      if (!keepSelection) {
        setLoadingList(true);
      }

      const response = await fetch("/api/chat/admin/conversations", {
        method: "GET",
        cache: "no-store",
      });

      const json = (await response.json()) as ConversationsResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load conversations.");
      }

      const nextConversations = json.conversations || [];
      setConversations(nextConversations);
      setListError(null);

      if (!keepSelection) {
        if (nextConversations.length > 0) {
          setSelectedConversationId((prev) => {
            if (prev && nextConversations.some((item) => item.id === prev)) {
              return prev;
            }
            return nextConversations[0].id;
          });
        } else {
          setSelectedConversationId("");
        }
      } else if (selectedConversationId && !nextConversations.some((item) => item.id === selectedConversationId)) {
        setSelectedConversationId(nextConversations[0]?.id || "");
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to load conversations.");
    } finally {
      setLoadingList(false);
    }
  };

  const loadMessages = async (conversationId: string) => {
    if (!conversationId) return;

    try {
      setLoadingMessages(true);

      const response = await fetch(
        `/api/chat/admin/messages?conversationId=${encodeURIComponent(conversationId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load chat messages.");
      }

      setMessages(json.messages || []);
      setMessageError(null);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Failed to load chat messages.");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    void loadConversations(false);
  }, []);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedConversationId);
  }, [selectedConversationId]);

  useEffect(() => {
    const listPoll = window.setInterval(() => {
      if (document.hidden) return;
      void loadConversations(true);
    }, 3000);

    return () => {
      window.clearInterval(listPoll);
    };
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId) return;

    const messagePoll = window.setInterval(() => {
      if (document.hidden) return;
      void loadMessages(selectedConversationId);
    }, 2000);

    return () => {
      window.clearInterval(messagePoll);
    };
  }, [selectedConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleReply = async () => {
    const nextBody = reply.trim();

    if (!selectedConversationId || !nextBody || sending) return;

    try {
      setSending(true);

      const response = await fetch("/api/chat/admin/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversationId,
          body: nextBody,
        }),
      });

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to send reply.");
      }

      setReply("");
      await Promise.all([
        loadConversations(true),
        loadMessages(selectedConversationId),
      ]);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Failed to send reply.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="grid min-h-[680px] gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-[28px] border border-white/70 bg-white/82 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="mb-4">
          <h3 className="text-lg font-bold tracking-[-0.03em] text-slate-900">聊天列表</h3>
          <p className="mt-1 text-sm text-slate-500">
            前台所有页面右下角聊天浮窗发来的消息都在这里处理。
          </p>
        </div>

        {loadingList ? (
          <div className="text-sm text-slate-500">Loading conversations...</div>
        ) : listError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {listError}
          </div>
        ) : conversations.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            No active conversations yet.
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => {
              const isActive = conversation.id === selectedConversationId;

              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedConversationId(conversation.id)}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition-all ${
                    isActive
                      ? "border-slate-900 bg-slate-950 text-white shadow-[0_14px_40px_rgba(15,23,42,0.18)]"
                      : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {conversation.userEmail || conversation.userName || "Guest visitor"}
                      </div>
                      <div
                        className={`mt-1 truncate text-xs ${
                          isActive ? "text-white/70" : "text-slate-500"
                        }`}
                      >
                        {conversation.sourcePath || "Unknown page"}
                      </div>
                    </div>

                    {conversation.adminUnreadCount > 0 ? (
                      <span
                        className={`inline-flex min-w-[24px] items-center justify-center rounded-full px-2 py-1 text-[11px] font-bold ${
                          isActive
                            ? "bg-white/15 text-white"
                            : "bg-rose-100 text-rose-600"
                        }`}
                      >
                        {conversation.adminUnreadCount}
                      </span>
                    ) : null}
                  </div>

                  <div
                    className={`mt-3 line-clamp-2 text-sm ${
                      isActive ? "text-white/85" : "text-slate-600"
                    }`}
                  >
                    {conversation.lastMessagePreview || "No messages yet"}
                  </div>

                  <div
                    className={`mt-3 text-[11px] ${
                      isActive ? "text-white/60" : "text-slate-400"
                    }`}
                  >
                    {formatTime(conversation.lastMessageAt)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-[28px] border border-white/70 bg-white/82 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-xl">
        <div className="border-b border-slate-200/80 px-6 py-5">
          {selectedConversation ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold tracking-[-0.03em] text-slate-900">
                  {selectedConversation.userEmail || selectedConversation.userName || "Guest visitor"}
                </h3>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  {selectedConversation.status}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span>Source: {selectedConversation.sourcePath || "Unknown"}</span>
                <span>Created: {formatTime(selectedConversation.createdAt)}</span>
                <span>Last active: {formatTime(selectedConversation.lastMessageAt)}</span>
              </div>
            </>
          ) : (
            <h3 className="text-lg font-bold tracking-[-0.03em] text-slate-900">
              选择左侧会话开始回复
            </h3>
          )}
        </div>

        <div className="max-h-[480px] overflow-y-auto px-6 py-5">
          {!selectedConversationId ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Select a conversation from the left list.
            </div>
          ) : loadingMessages ? (
            <div className="text-sm text-slate-500">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              This conversation has no messages yet.
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const isAdmin = message.senderRole === "admin";

                return (
                  <div
                    key={message.id}
                    className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        isAdmin
                          ? "bg-slate-950 text-white"
                          : "border border-slate-200 bg-white text-slate-800"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.body}</div>
                      <div
                        className={`mt-2 text-[11px] ${
                          isAdmin ? "text-white/60" : "text-slate-400"
                        }`}
                      >
                        {formatTime(message.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}

          {messageError ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {messageError}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200/80 px-6 py-5">
          <div className="flex items-end gap-3">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder="Reply to this visitor..."
              rows={4}
              className="min-h-[110px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
            />

            <button
              type="button"
              onClick={handleReply}
              disabled={!selectedConversationId || !reply.trim() || sending}
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}