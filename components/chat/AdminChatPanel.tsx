"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Clock3, MessageSquare, Search, Send } from "lucide-react";

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
  duplicateSkipped?: boolean;
  error?: string;
};

type StatusResponse = {
  ok: boolean;
  conversation?: ConversationItem;
  error?: string;
};

const ADMIN_CONVERSATION_LIMIT = 100;
const ADMIN_MESSAGE_LIMIT = 100;
const MAX_ADMIN_REPLY_LENGTH = 2000;

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isNearBottom(element: HTMLElement) {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance < 56;
}

function MetricPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-[18px] border border-white/70 bg-white/80 px-4 py-3 shadow-[0_20px_50px_rgba(168,85,247,0.08)] ring-1 ring-white/60 backdrop-blur-2xl">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-bold tracking-[-0.03em] text-slate-900">{value}</div>
    </div>
  );
}

export default function AdminChatPanel() {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const listPollingRef = useRef(false);
  const messagePollingRef = useRef(false);
  const previousMessageCountRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const lastSentRef = useRef<{ body: string; at: number } | null>(null);

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesInitialized, setMessagesInitialized] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const filteredConversations = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      const haystack = [
        conversation.userEmail || "",
        conversation.userName || "",
        conversation.sourcePath || "",
        conversation.lastMessagePreview || "",
        conversation.status || "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(keyword);
    });
  }, [conversations, search]);

  const openCount = conversations.filter((item) => item.status === "open").length;
  const unreadCount = conversations.reduce((sum, item) => sum + item.adminUnreadCount, 0);
  const closedCount = conversations.filter((item) => item.status === "closed").length;

  const loadConversations = async (keepSelection = true) => {
    if (listPollingRef.current) return;

    try {
      listPollingRef.current = true;

      if (!keepSelection) {
        setLoadingList(true);
      }

      const response = await fetch(
        `/api/chat/admin/conversations?limit=${ADMIN_CONVERSATION_LIMIT}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await response.json()) as ConversationsResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load conversations.");
      }

      const nextConversations = json.conversations || [];
      setConversations(nextConversations);
      setListError(null);

      setSelectedConversationId((prev) => {
        if (nextConversations.length === 0) {
          return "";
        }

        if (keepSelection && prev && nextConversations.some((item) => item.id === prev)) {
          return prev;
        }

        return nextConversations[0].id;
      });
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to load conversations.");
    } finally {
      listPollingRef.current = false;
      setLoadingList(false);
    }
  };

  const loadMessages = async (
    conversationId: string,
    options?: {
      showLoading?: boolean;
      markRead?: boolean;
      forceScroll?: boolean;
    }
  ) => {
    if (!conversationId || messagePollingRef.current) return;

    try {
      messagePollingRef.current = true;

      if (options?.showLoading) {
        setLoadingMessages(true);
      }

      const markRead = options?.markRead ? "1" : "0";

      const response = await fetch(
        `/api/chat/admin/messages?conversationId=${encodeURIComponent(
          conversationId
        )}&markRead=${markRead}&limit=${ADMIN_MESSAGE_LIMIT}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load chat messages.");
      }

      const nextMessages = json.messages || [];
      const shouldAutoScroll =
        options?.forceScroll ||
        forceScrollRef.current ||
        previousMessageCountRef.current === 0 ||
        shouldStickToBottomRef.current;

      setMessages(nextMessages);

      if (options?.markRead) {
        setConversations((prev) =>
          prev.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  adminUnreadCount: 0,
                }
              : item
          )
        );
      }

      setMessageError(null);
      setMessagesInitialized(true);

      if (shouldAutoScroll) {
        window.requestAnimationFrame(() => {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
          forceScrollRef.current = false;
        });
      }
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Failed to load chat messages.");
    } finally {
      messagePollingRef.current = false;

      if (options?.showLoading) {
        setLoadingMessages(false);
      }
    }
  };

  useEffect(() => {
    void loadConversations(false);
  }, []);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setMessagesInitialized(false);
      previousMessageCountRef.current = 0;
      return;
    }

    setMessages([]);
    setMessagesInitialized(false);
    previousMessageCountRef.current = 0;
    forceScrollRef.current = true;

    void loadMessages(selectedConversationId, {
      showLoading: true,
      markRead: document.visibilityState === "visible",
      forceScroll: true,
    });
  }, [selectedConversationId]);

  useEffect(() => {
    const listPoll = window.setInterval(() => {
      if (document.hidden) return;
      void loadConversations(true);
    }, 15000);

    return () => {
      window.clearInterval(listPoll);
    };
  }, []);

  useEffect(() => {
    if (!selectedConversationId) return;

    const messagePoll = window.setInterval(() => {
      if (document.hidden) return;

      void loadMessages(selectedConversationId, {
        markRead: true,
      });
    }, 6000);

    return () => {
      window.clearInterval(messagePoll);
    };
  }, [selectedConversationId]);

  useEffect(() => {
    previousMessageCountRef.current = messages.length;
  }, [messages]);

  const handleReply = async () => {
    const nextBody = reply.trim();

    if (!selectedConversationId || !nextBody || sending) return;

    if (nextBody.length > MAX_ADMIN_REPLY_LENGTH) {
      setMessageError(`回复内容不能超过 ${MAX_ADMIN_REPLY_LENGTH} 个字符。`);
      return;
    }

    const now = Date.now();
    const lastSent = lastSentRef.current;

    if (lastSent && lastSent.body === nextBody && now - lastSent.at < 1200) {
      return;
    }

    try {
      setSending(true);
      setMessageError(null);

      lastSentRef.current = {
        body: nextBody,
        at: now,
      };

      forceScrollRef.current = true;

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
        loadMessages(selectedConversationId, {
          markRead: true,
          forceScroll: true,
        }),
      ]);
    } catch (error) {
      setMessageError(error instanceof Error ? error.message : "Failed to send reply.");
    } finally {
      setSending(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedConversation || statusChanging) return;

    const nextStatus = selectedConversation.status === "open" ? "closed" : "open";

    try {
      setStatusChanging(true);
      setMessageError(null);

      const response = await fetch("/api/chat/admin/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          status: nextStatus,
        }),
      });

      const json = (await response.json()) as StatusResponse;

      if (!response.ok || !json.ok || !json.conversation) {
        throw new Error(json.error || "Failed to update conversation status.");
      }

      setConversations((prev) =>
        prev.map((item) => (item.id === json.conversation?.id ? json.conversation : item))
      );
    } catch (error) {
      setMessageError(
        error instanceof Error ? error.message : "Failed to update conversation status."
      );
    } finally {
      setStatusChanging(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricPill icon={<MessageSquare className="h-4 w-4" />} label="总会话" value={conversations.length} />
        <MetricPill icon={<Clock3 className="h-4 w-4" />} label="未读" value={unreadCount} />
        <MetricPill icon={<CheckCircle2 className="h-4 w-4" />} label="已关闭" value={closedCount} />
      </div>

      <section className="grid min-h-[680px] gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="rounded-[24px] border border-white/70 bg-white/78 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="bg-gradient-to-r from-fuchsia-600 to-purple-600 bg-clip-text text-lg font-bold tracking-[-0.03em] text-transparent">
                管理员聊天
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                未读优先排序。前台所有页面右下角聊天浮窗发来的消息都在这里处理。
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/70 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
              <span>进行中</span>
              <span>{openCount}</span>
            </span>
          </div>

          <div className="mb-4 rounded-[18px] border border-white/70 bg-white/78 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <div className="flex items-center gap-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索邮箱、页面或消息内容..."
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {loadingList ? (
            <div className="text-sm text-slate-500">Loading conversations...</div>
          ) : listError ? (
            <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {listError}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No matching conversations.
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredConversations.map((conversation) => {
                const isActive = conversation.id === selectedConversationId;

                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      setSelectedConversationId(conversation.id);
                      forceScrollRef.current = true;
                    }}
                    className={`relative w-full overflow-hidden rounded-[16px] border px-4 py-2 text-left transition-all duration-200 hover:translate-x-[2px] hover:shadow-md ${
                      isActive
                        ? "border-fuchsia-400 bg-gradient-to-br from-fuchsia-100 to-purple-50 text-slate-900 shadow-[0_20px_45px_rgba(168,85,247,0.25)] ring-1 ring-fuchsia-300/60"
                        : "border-white/70 bg-white/80 text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.04)] hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="truncate text-[14px] font-semibold">
                          {conversation.userEmail || conversation.userName || "游客访客"}
                        </div>
                        <div className="mt-[2px] flex items-center gap-3 text-[11px] text-slate-500">
                          <span className="truncate pr-2">{conversation.sourcePath || "未知页面"}</span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-start gap-2">
                        <div className="flex flex-col items-end gap-[3px]">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-[4px] text-[10px] font-semibold ${
                              conversation.status === "open"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {conversation.status === "open" ? "活跃" : "关闭"}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-400">
                            {formatTime(conversation.lastMessageAt)}
                          </span>
                        </div>

                        {conversation.adminUnreadCount > 0 && (
                          <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white shadow-sm">
                            {conversation.adminUnreadCount}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-1.5 truncate text-[12.5px] text-slate-500">
                      {conversation.lastMessagePreview || "暂无消息"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/78 shadow-[0_18px_54px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
          <div className="border-b border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.48))] px-6 py-5">
            {selectedConversation ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold tracking-[-0.03em] text-slate-900">
                      {selectedConversation.userEmail || selectedConversation.userName || "Guest visitor"}
                    </h3>
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                        selectedConversation.status === "open"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-600"
                      }`}
                    >
                      {selectedConversation.status === "open" ? "进行中" : "已关闭"}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>来源：{selectedConversation.sourcePath || "未知"}</span>
                    <span>创建时间：{formatTime(selectedConversation.createdAt)}</span>
                    <span>最后活跃：{formatTime(selectedConversation.lastMessageAt)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleToggleStatus}
                  disabled={statusChanging}
                  className="inline-flex items-center rounded-full border border-white/70 bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.04)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {selectedConversation.status === "open" ? "关闭会话" : "重新打开"}
                </button>
              </div>
            ) : (
              <h3 className="text-lg font-bold tracking-[-0.03em] text-slate-900">选择一个会话</h3>
            )}
          </div>

          <div
            ref={messagesContainerRef}
            onScroll={(event) => {
              shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
            }}
            className="min-h-[520px] overflow-y-auto border-t border-white/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.16))] px-6 py-5"
          >
            {!selectedConversationId ? (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Select a conversation from the left list.
              </div>
            ) : !messagesInitialized && loadingMessages ? (
              <div className="text-sm text-slate-500">Loading messages...</div>
            ) : messages.length === 0 ? (
              <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                This conversation has no messages yet.
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => {
                  const isAdmin = message.senderRole === "admin";

                  return (
                    <div key={message.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[76%]">
                        <div
                          className={`rounded-[16px] px-3.5 py-2 text-sm ${
                            isAdmin
                              ? "bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-[0_18px_40px_rgba(168,85,247,0.28)]"
                              : "border border-white/70 bg-white/78 text-slate-800 shadow-[0_12px_28px_rgba(15,23,42,0.06)]"
                          }`}
                        >
                          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {message.body}
                          </div>
                        </div>
                        <div className={`mt-[2px] text-[11px] text-slate-400/80 ${isAdmin ? "text-right" : "text-left"}`}>
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
              <div className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {messageError}
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.46))] px-6 py-4">
            <div className="relative">
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value.slice(0, MAX_ADMIN_REPLY_LENGTH))}
                placeholder={
                  selectedConversation?.status === "closed"
                    ? "该会话已关闭..."
                    : "写回复内容..."
                }
                rows={4}
                maxLength={MAX_ADMIN_REPLY_LENGTH}
                disabled={!selectedConversationId || selectedConversation?.status === "closed"}
                className="min-h-[88px] w-full resize-none rounded-[20px] border border-white/50 bg-white/78 px-4 py-3 pr-16 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none backdrop-blur-sm transition-all duration-200 focus:border-fuchsia-300 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />

              <button
                type="button"
                onClick={handleReply}
                disabled={
                  !selectedConversationId ||
                  !reply.trim() ||
                  sending ||
                  selectedConversation?.status === "closed"
                }
                className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-[15px] bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 text-white shadow-[0_14px_32px_rgba(168,85,247,0.32)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
