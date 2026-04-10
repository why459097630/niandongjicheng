"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessageCircle, Send, UserRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const GUEST_SESSION_STORAGE_KEY = "ndjc_support_guest_session_id";

type ChatMessage = {
  id: string;
  senderRole: "user" | "admin";
  body: string;
  createdAt: string;
};

type ConversationSummary = {
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

type ChatSupabaseClient = ReturnType<typeof createClient>;

type BootstrapResponse = {
  ok: boolean;
  conversation?: {
    id: string;
    guestSessionId: string;
    userEmail: string | null;
    userName: string | null;
    sourcePath: string | null;
  };
  error?: string;
};

type MessagesResponse = {
  ok: boolean;
  messages?: ChatMessage[];
  error?: string;
};

type ConversationResponse = {
  ok: boolean;
  conversation?: ConversationSummary | null;
  error?: string;
};

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function createGuestSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function FloatingChatWidget() {
  const supabase = useMemo<ChatSupabaseClient | null>(() => {
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasKey = !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!hasUrl || !hasKey) {
      return null;
    }

    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagePollingRef = useRef(false);
  const summaryPollingRef = useRef(false);
  const contactSaveTimerRef = useRef<number | null>(null);
  const previousMessageCountRef = useRef(0);

  const [isOpen, setIsOpen] = useState(false);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [guestSessionId, setGuestSessionId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const existing =
      typeof window !== "undefined"
        ? window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY)
        : null;

    if (existing) {
      setGuestSessionId(existing);
      return;
    }

    const nextId = createGuestSessionId();

    if (typeof window !== "undefined") {
      window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, nextId);
    }

    setGuestSessionId(nextId);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthChecked(true);
      return;
    }

    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;

      const email = data.user?.email || "";
      setUserEmail(email);

      if (email && !userName) {
        setUserName(email.split("@")[0] || "");
      }

      setAuthChecked(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      const email = session?.user?.email || "";
      setUserEmail(email);

      if (email) {
        setUserName((prev) => prev || email.split("@")[0] || "");
      }

      setAuthChecked(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, userName]);

  const saveContactInfo = async () => {
    if ((!conversationId && !guestSessionId) || (!userEmail.trim() && !userName.trim())) {
      return;
    }

    try {
      await fetch("/api/chat/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: conversationId || null,
          guestSessionId: guestSessionId || null,
          userEmail: userEmail.trim() || null,
          userName: userName.trim() || null,
        }),
      });
    } catch {
      // 联系方式保存失败不阻断聊天主流程
    }
  };

  const refreshConversationSummary = async () => {
    if (!guestSessionId || summaryPollingRef.current) return;

    try {
      summaryPollingRef.current = true;

      const response = await fetch(
        `/api/chat/conversation?guestSessionId=${encodeURIComponent(guestSessionId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await response.json()) as ConversationResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load conversation summary.");
      }

      if (!json.conversation) return;

      setConversationId(json.conversation.id);
      setUnreadCount(json.conversation.userUnreadCount || 0);

      if (!userEmail && json.conversation.userEmail) {
        setUserEmail(json.conversation.userEmail);
      }

      if (!userName && json.conversation.userName) {
        setUserName(json.conversation.userName);
      }
    } catch {
      // 挂件按钮不要因为摘要请求失败而报整块错误
    } finally {
      summaryPollingRef.current = false;
    }
  };

  const loadMessages = async (targetConversationId: string, targetGuestSessionId: string) => {
    if (messagePollingRef.current) return;

    try {
      messagePollingRef.current = true;

      const response = await fetch(
        `/api/chat/messages?conversationId=${encodeURIComponent(
          targetConversationId
        )}&guestSessionId=${encodeURIComponent(targetGuestSessionId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load messages.");
      }

      const nextMessages = json.messages || [];
      setMessages(nextMessages);
      setUnreadCount(0);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load messages.");
    } finally {
      messagePollingRef.current = false;
    }
  };

  const bootstrapConversation = async () => {
    if (!guestSessionId || bootstrapping) return;

    try {
      setBootstrapping(true);
      setLoadError(null);

      const response = await fetch("/api/chat/bootstrap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guestSessionId,
          userEmail: userEmail.trim() || null,
          userName: userName.trim() || null,
          sourcePath: typeof window !== "undefined" ? window.location.pathname : "/",
        }),
      });

      const json = (await response.json()) as BootstrapResponse;

      if (!response.ok || !json.ok || !json.conversation) {
        throw new Error(json.error || "Failed to start support chat.");
      }

      setConversationId(json.conversation.id);

      if (!userEmail && json.conversation.userEmail) {
        setUserEmail(json.conversation.userEmail);
      }

      if (!userName && json.conversation.userName) {
        setUserName(json.conversation.userName);
      }

      await loadMessages(json.conversation.id, guestSessionId);
      await refreshConversationSummary();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to start support chat.");
    } finally {
      setBootstrapping(false);
    }
  };

  useEffect(() => {
    if (!guestSessionId) return;
    void refreshConversationSummary();
  }, [guestSessionId]);

  useEffect(() => {
    if (!isOpen || !guestSessionId) return;
    void bootstrapConversation();
  }, [isOpen, guestSessionId]);

  useEffect(() => {
    if (!isOpen || !conversationId || !guestSessionId) return;

    const poll = window.setInterval(() => {
      if (document.hidden) return;
      void loadMessages(conversationId, guestSessionId);
    }, 2000);

    return () => {
      window.clearInterval(poll);
    };
  }, [isOpen, conversationId, guestSessionId]);

  useEffect(() => {
    if (isOpen || !guestSessionId) return;

    const poll = window.setInterval(() => {
      if (document.hidden) return;
      void refreshConversationSummary();
    }, 6000);

    return () => {
      window.clearInterval(poll);
    };
  }, [isOpen, guestSessionId]);

  useEffect(() => {
    if (!isOpen) {
      previousMessageCountRef.current = messages.length;
      return;
    }

    if (messages.length > previousMessageCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }

    previousMessageCountRef.current = messages.length;
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen || !conversationId) return;

    if (contactSaveTimerRef.current) {
      window.clearTimeout(contactSaveTimerRef.current);
    }

    contactSaveTimerRef.current = window.setTimeout(() => {
      void saveContactInfo();
    }, 600);

    return () => {
      if (contactSaveTimerRef.current) {
        window.clearTimeout(contactSaveTimerRef.current);
      }
    };
  }, [conversationId, guestSessionId, userEmail, userName, isOpen]);

  const handleSend = async () => {
    const nextBody = draft.trim();

    if (!nextBody || !conversationId || !guestSessionId || sending) return;

    try {
      setSending(true);
      setLoadError(null);

      await saveContactInfo();

      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          guestSessionId,
          body: nextBody,
        }),
      });

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to send message.");
      }

      setDraft("");
      await loadMessages(conversationId, guestSessionId);
      await refreshConversationSummary();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const shouldShowContactToggle = !userEmail;
  const shouldShowContactPanel = contactInfoOpen && !userEmail;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-[80] inline-flex h-14 items-center justify-center rounded-full border border-white/80 bg-white/90 px-5 text-sm font-semibold text-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
      >
        <div className="relative mr-2">
          <MessageCircle className="h-5 w-5 text-fuchsia-500" />
          {!isOpen && unreadCount > 0 ? (
            <span className="absolute -right-2 -top-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </div>
        Chat
      </button>

      {isOpen ? (
        <div className="fixed bottom-24 right-6 z-[80] w-[360px] overflow-hidden rounded-[24px] border border-white/80 bg-white/92 shadow-[0_24px_64px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <div className="text-sm font-bold tracking-[-0.02em] text-slate-950">与NDJC的聊天</div>
              <div className="mt-1 text-xs text-slate-500">
                询问价格、构建情况、历史或云更新情况。
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!authChecked ? (
            <div className="px-5 py-6 text-sm text-slate-500">Checking chat identity...</div>
          ) : (
            <>
              {shouldShowContactToggle ? (
                <div className="border-b border-slate-200/80 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setContactInfoOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <UserRound className="h-4 w-4 text-slate-400" />
                      <div>
                        <div className="text-sm font-semibold text-slate-900">添加联系方式</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          可选。这有助于我们后续跟进。
                        </div>
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-slate-400 transition-transform ${
                        contactInfoOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                </div>
              ) : null}

              {shouldShowContactPanel ? (
                <div className="space-y-2.5 border-b border-slate-200/80 px-5 py-4">
                  <input
                    value={userName}
                    onChange={(event) => setUserName(event.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                  />

                  <input
                    value={userEmail}
                    onChange={(event) => setUserEmail(event.target.value)}
                    placeholder="Your email"
                    className="w-full rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                  />
                </div>
              ) : null}

              <div className="max-h-[360px] overflow-y-auto px-5 py-4">
                {bootstrapping ? (
                  <div className="text-sm text-slate-500">Opening support chat...</div>
                ) : messages.length === 0 ? (
                  <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                    发送你的第一条留言，回复会显示在这里。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {messages.map((message) => {
                      const isUser = message.senderRole === "user";

                      return (
                        <div
                          key={message.id}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-[16px] px-3.5 py-2 text-sm shadow-sm ${
                              isUser
                                ? "bg-slate-950 text-white"
                                : "border border-slate-200 bg-white text-slate-800"
                            }`}
                          >
                            <div className="whitespace-pre-wrap break-words">{message.body}</div>
                            <div
                              className={`mt-1.5 text-[11px] ${
                                isUser ? "text-white/60" : "text-slate-400"
                              }`}
                            >
                              {formatMessageTime(message.createdAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>

              {loadError ? (
                <div className="px-5 pb-2 text-xs text-rose-600">{loadError}</div>
              ) : null}

              <div className="border-t border-slate-200/80 px-5 py-4">
                <div className="flex items-end gap-3">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="输入你的留言……"
                    rows={3}
                    className="min-h-[80px] flex-1 resize-none rounded-[16px] border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                  />

                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || bootstrapping || !conversationId || !draft.trim()}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-[16px] bg-slate-950 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}