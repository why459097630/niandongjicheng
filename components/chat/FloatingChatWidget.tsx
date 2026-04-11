"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MessageCircle, Send, UserRound, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const GUEST_SESSION_STORAGE_KEY = "ndjc_support_guest_session_id";
const GUEST_ACCESS_TOKEN_STORAGE_KEY = "ndjc_support_guest_access_token";
const MAX_CHAT_MESSAGE_LENGTH = 2000;
const CHAT_MESSAGE_LIMIT = 100;

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
  accessToken: string;
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
    accessToken: string;
  };
  error?: string;
};

type MessagesResponse = {
  ok: boolean;
  messages?: ChatMessage[];
  duplicateSkipped?: boolean;
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

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function createGuestSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isNearBottom(element: HTMLElement) {
  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distance < 48;
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

  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagePollingRef = useRef(false);
  const summaryPollingRef = useRef(false);
  const contactSaveTimerRef = useRef<number | null>(null);
  const previousMessageCountRef = useRef(0);
  const shouldStickToBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const lastSentRef = useRef<{ body: string; at: number } | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [contactInfoOpen, setContactInfoOpen] = useState(false);
  const [guestSessionId, setGuestSessionId] = useState("");
  const [guestAccessToken, setGuestAccessToken] = useState("");
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

  const syncGuestSessionId = (nextId: string) => {
    setGuestSessionId(nextId);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(GUEST_SESSION_STORAGE_KEY, nextId);
    }
  };

  const syncGuestAccessToken = (nextToken: string) => {
    setGuestAccessToken(nextToken);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(GUEST_ACCESS_TOKEN_STORAGE_KEY, nextToken);
    }
  };

  useEffect(() => {
    const existingGuestSessionId =
      typeof window !== "undefined"
        ? window.localStorage.getItem(GUEST_SESSION_STORAGE_KEY)
        : null;

    const existingGuestAccessToken =
      typeof window !== "undefined"
        ? window.localStorage.getItem(GUEST_ACCESS_TOKEN_STORAGE_KEY)
        : null;

    if (existingGuestSessionId) {
      setGuestSessionId(existingGuestSessionId);
    } else {
      const nextId = createGuestSessionId();
      syncGuestSessionId(nextId);
    }

    if (existingGuestAccessToken) {
      setGuestAccessToken(existingGuestAccessToken);
    }
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

      if (email) {
        setUserName((prev) => prev || email.split("@")[0] || "");
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
  }, [supabase]);

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
          accessToken: guestAccessToken || null,
          userEmail: userEmail.trim() || null,
          userName: userName.trim() || null,
        }),
      });
    } catch {
      // Do not block the main chat flow.
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    bottomRef.current?.scrollIntoView({ behavior });
  };

  const refreshConversationSummary = async () => {
    if (!guestSessionId || summaryPollingRef.current) return;

    try {
      summaryPollingRef.current = true;

      const query = new URLSearchParams({
        guestSessionId,
        accessToken: guestAccessToken || "",
      });

      const response = await fetch(`/api/chat/conversation?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const json = (await response.json()) as ConversationResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load conversation summary.");
      }

      if (!json.conversation) return;

      setConversationId(json.conversation.id);
      setUnreadCount(json.conversation.userUnreadCount || 0);

      if (json.conversation.guestSessionId && json.conversation.guestSessionId !== guestSessionId) {
        syncGuestSessionId(json.conversation.guestSessionId);
      }

      if (json.conversation.accessToken) {
        syncGuestAccessToken(json.conversation.accessToken);
      }

      if (!userEmail && json.conversation.userEmail) {
        setUserEmail(json.conversation.userEmail);
      }

      if (!userName && json.conversation.userName) {
        setUserName(json.conversation.userName);
      }
    } catch {
      // Do not make the widget button fail as a whole.
    } finally {
      summaryPollingRef.current = false;
    }
  };

  const loadMessages = async (
    targetConversationId: string,
    targetGuestSessionId: string,
    options?: {
      markRead?: boolean;
      forceScroll?: boolean;
    }
  ) => {
    if (messagePollingRef.current || !guestAccessToken) return;

    try {
      messagePollingRef.current = true;

      const markRead = options?.markRead ? "1" : "0";
      const query = new URLSearchParams({
        conversationId: targetConversationId,
        guestSessionId: targetGuestSessionId,
        accessToken: guestAccessToken,
        markRead,
        limit: String(CHAT_MESSAGE_LIMIT),
      });

      const response = await fetch(`/api/chat/messages?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load messages.");
      }

      const nextMessages = json.messages || [];
      const shouldAutoScroll =
        options?.forceScroll ||
        forceScrollRef.current ||
        previousMessageCountRef.current === 0 ||
        shouldStickToBottomRef.current;

      setMessages(nextMessages);
      setLoadError(null);

      if (options?.markRead) {
        setUnreadCount(0);
      }

      if (shouldAutoScroll) {
        window.requestAnimationFrame(() => {
          scrollToBottom("auto");
          forceScrollRef.current = false;
        });
      }
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

      if (json.conversation.guestSessionId && json.conversation.guestSessionId !== guestSessionId) {
        syncGuestSessionId(json.conversation.guestSessionId);
      }

      if (json.conversation.accessToken) {
        syncGuestAccessToken(json.conversation.accessToken);
      }

      if (!userEmail && json.conversation.userEmail) {
        setUserEmail(json.conversation.userEmail);
      }

      if (!userName && json.conversation.userName) {
        setUserName(json.conversation.userName);
      }

      forceScrollRef.current = true;

      await loadMessages(json.conversation.id, json.conversation.guestSessionId, {
        markRead: document.visibilityState === "visible",
        forceScroll: true,
      });

      await refreshConversationSummary();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to start support chat.");
    } finally {
      setBootstrapping(false);
    }
  };

  useEffect(() => {
    if (!guestSessionId || !authChecked) return;
    void refreshConversationSummary();
  }, [guestSessionId, authChecked]);

  useEffect(() => {
    if (!isOpen || !guestSessionId || !authChecked) return;
    void bootstrapConversation();
  }, [isOpen, guestSessionId, authChecked]);

  useEffect(() => {
    if (!isOpen || !conversationId || !guestSessionId || !guestAccessToken) return;

    const poll = window.setInterval(() => {
      if (document.hidden) return;

      void loadMessages(conversationId, guestSessionId, {
        markRead: true,
      });
    }, 6000);

    return () => {
      window.clearInterval(poll);
    };
  }, [isOpen, conversationId, guestSessionId, guestAccessToken]);

  useEffect(() => {
    if (isOpen || !guestSessionId) return;

    const poll = window.setInterval(() => {
      if (document.hidden) return;
      void refreshConversationSummary();
    }, 15000);

    return () => {
      window.clearInterval(poll);
    };
  }, [isOpen, guestSessionId]);

  useEffect(() => {
    previousMessageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (!isOpen || !conversationId) return;

    if (contactSaveTimerRef.current) {
      window.clearTimeout(contactSaveTimerRef.current);
    }

    contactSaveTimerRef.current = window.setTimeout(() => {
      void saveContactInfo();
    }, 700);

    return () => {
      if (contactSaveTimerRef.current) {
        window.clearTimeout(contactSaveTimerRef.current);
      }
    };
  }, [conversationId, guestSessionId, userEmail, userName, isOpen]);

  const handleSend = async () => {
    const nextBody = draft.trim();

    if (!nextBody || !conversationId || !guestSessionId || !guestAccessToken || sending) return;

    if (nextBody.length > MAX_CHAT_MESSAGE_LENGTH) {
      setLoadError(`Message must be under ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
      return;
    }

    const now = Date.now();
    const lastSent = lastSentRef.current;

    if (lastSent && lastSent.body === nextBody && now - lastSent.at < 1200) {
      return;
    }

    try {
      setSending(true);
      setLoadError(null);

      lastSentRef.current = {
        body: nextBody,
        at: now,
      };

      await saveContactInfo();

      forceScrollRef.current = true;

      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          guestSessionId,
          accessToken: guestAccessToken,
          body: nextBody,
        }),
      });

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to send message.");
      }

      setDraft("");

      await loadMessages(conversationId, guestSessionId, {
        markRead: document.visibilityState === "visible",
        forceScroll: true,
      });

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
        <span>Chat</span>
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-24 right-6 z-[80] w-[392px] overflow-hidden rounded-[30px] border border-white/65 bg-white/72 shadow-[0_32px_90px_rgba(168,85,247,0.12),0_24px_64px_rgba(15,23,42,0.12)] backdrop-blur-3xl"
          >
            <div className="flex items-center justify-between border-b border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(255,255,255,0.48))] px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="bg-gradient-to-r from-fuchsia-600 to-purple-600 bg-clip-text text-[15px] font-semibold tracking-[-0.02em] text-transparent">
                    Think it Done Chat
                  </div>
                  
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  Replies may be delayed due to time zone differences
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/70 text-slate-500 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!authChecked ? (
              <div className="px-5 py-6 text-sm text-slate-500">Checking chat identity...</div>
            ) : (
              <>
                {shouldShowContactToggle ? (
                  <div className="border-b border-white/60 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setContactInfoOpen((prev) => !prev)}
                      className="flex w-full items-center justify-between rounded-[18px] border border-white/60 bg-white/55 px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition-all duration-200 hover:bg-white/70"
                    >
                      <div className="flex items-center gap-3">
                        <UserRound className="h-4 w-4 text-slate-400" />
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Add contact info</div>
                          <div className="mt-0.5 text-xs text-slate-500">Optional. Helps us follow up later.</div>
                        </div>
                      </div>
                      <ChevronDown
                        className={`h-4 w-4 text-slate-400 transition-transform ${contactInfoOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                  </div>
                ) : null}

                {shouldShowContactPanel ? (
                  <div className="space-y-2.5 border-b border-white/60 bg-white/35 px-5 py-4">
                    <input
                      value={userName}
                      onChange={(event) => setUserName(event.target.value)}
                      placeholder="Your name"
                      className="w-full rounded-[14px] border border-slate-200/80 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                    />

                    <input
                      value={userEmail}
                      onChange={(event) => setUserEmail(event.target.value)}
                      placeholder="Your email"
                      className="w-full rounded-[14px] border border-slate-200/80 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                    />
                  </div>
                ) : null}

                <div
                  ref={messagesContainerRef}
                  onScroll={(event) => {
                    shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
                  }}
                  className="max-h-[420px] overflow-y-auto bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.18))] px-5 py-4"
                >
                  {bootstrapping ? (
                    <div className="text-sm text-slate-500">Opening support chat...</div>
                  ) : messages.length === 0 ? (
                    <div className="rounded-[16px] border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                      Send your first message. Replies will appear here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {messages.map((message, index) => {
                        const isUser = message.senderRole === "user";

                        return (
                          <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.22, delay: index * 0.04 }}
                            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                          >
                            <div className="max-w-[80%]">
                              <div
                                className={`rounded-[15px] px-3 py-2 text-sm transition-all duration-200 ${
                                  isUser
                                    ? "bg-gradient-to-br from-fuchsia-600 via-purple-600 to-indigo-600 text-white shadow-[0_18px_40px_rgba(168,85,247,0.32)]"
                                    : "bg-white/78 text-slate-800 ring-1 ring-white/75 shadow-[0_14px_32px_rgba(15,23,42,0.08)] backdrop-blur-md"
                                }`}
                              >
                                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {message.body}
                                </div>
                              </div>
                              <div
                                className={`mt-1 text-[11px] ${
                                  isUser ? "text-right text-fuchsia-200/90" : "text-left text-slate-500"
                                }`}
                              >
                                {formatMessageTime(message.createdAt)}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                      <div ref={bottomRef} />
                    </div>
                  )}
                </div>

                {loadError ? (
                  <div className="px-5 pb-2 text-xs text-rose-600">{loadError}</div>
                ) : null}

                <div className="border-t border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.46))] px-5 py-4">
                  <div className="relative">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value.slice(0, MAX_CHAT_MESSAGE_LENGTH))}
                      placeholder="Type your message…"
                      rows={3}
                      maxLength={MAX_CHAT_MESSAGE_LENGTH}
                      className="min-h-[76px] w-full resize-none rounded-[20px] border border-white/50 bg-white/78 px-4 py-3 pr-16 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none backdrop-blur-sm transition-all duration-200 focus:border-fuchsia-300 focus:bg-white"
                    />

                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={sending || bootstrapping || !conversationId || !draft.trim()}
                      className="absolute bottom-3 right-3 inline-flex h-11 w-11 items-center justify-center rounded-[15px] bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-600 text-white shadow-[0_14px_32px_rgba(168,85,247,0.32)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
