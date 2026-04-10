"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const GUEST_SESSION_STORAGE_KEY = "ndjc_support_guest_session_id";

type ChatMessage = {
  id: string;
  senderRole: "user" | "admin";
  body: string;
  createdAt: string;
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

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
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

  const [isOpen, setIsOpen] = useState(false);
  const [guestSessionId, setGuestSessionId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [sending, setSending] = useState(false);
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

  const loadMessages = async (targetConversationId: string, targetGuestSessionId: string) => {
    try {
      const response = await fetch(
        `/api/chat/messages?conversationId=${encodeURIComponent(targetConversationId)}&guestSessionId=${encodeURIComponent(targetGuestSessionId)}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const json = (await response.json()) as MessagesResponse;

      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Failed to load messages.");
      }

      setMessages(json.messages || []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load messages.");
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
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to start support chat.");
    } finally {
      setBootstrapping(false);
    }
  };

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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isOpen]);

  const handleSend = async () => {
    const nextBody = draft.trim();

    if (!nextBody || !conversationId || !guestSessionId || sending) return;

    try {
      setSending(true);
      setLoadError(null);

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
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-[80] inline-flex h-14 items-center justify-center rounded-full border border-white/80 bg-white/90 px-5 text-sm font-semibold text-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white"
      >
        <MessageCircle className="mr-2 h-5 w-5 text-fuchsia-500" />
        Chat
      </button>

      {isOpen ? (
        <div className="fixed bottom-24 right-6 z-[80] w-[360px] overflow-hidden rounded-[28px] border border-white/80 bg-white/92 shadow-[0_28px_80px_rgba(15,23,42,0.22)] backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-slate-200/80 px-5 py-4">
            <div>
              <div className="text-sm font-bold tracking-[-0.02em] text-slate-950">Chat with NDJC</div>
              <div className="mt-1 text-xs text-slate-500">
                Ask about pricing, builds, history, or cloud renewal.
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
              {!userEmail ? (
                <div className="space-y-3 border-b border-slate-200/80 px-5 py-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Optional contact info
                  </div>

                  <input
                    value={userName}
                    onChange={(event) => setUserName(event.target.value)}
                    placeholder="Your name"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                  />

                  <input
                    value={userEmail}
                    onChange={(event) => setUserEmail(event.target.value)}
                    placeholder="Your email"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                  />
                </div>
              ) : null}

              <div className="max-h-[360px] overflow-y-auto px-5 py-4">
                {bootstrapping ? (
                  <div className="text-sm text-slate-500">Opening support chat...</div>
                ) : messages.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    Send your first message. Replies will appear here in this chat window.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {messages.map((message) => {
                      const isUser = message.senderRole === "user";

                      return (
                        <div
                          key={message.id}
                          className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                              isUser
                                ? "bg-slate-950 text-white"
                                : "border border-slate-200 bg-white text-slate-800"
                            }`}
                          >
                            <div className="whitespace-pre-wrap break-words">{message.body}</div>
                            <div
                              className={`mt-2 text-[11px] ${
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
                    placeholder="Type your message..."
                    rows={3}
                    className="min-h-[92px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-colors focus:border-fuchsia-300"
                  />

                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || bootstrapping || !conversationId || !draft.trim()}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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