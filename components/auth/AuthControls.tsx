"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AuthControlsProps = {
  nextPath?: string;
};

type AdminAccessResponse = {
  ok: boolean;
  isAdmin?: boolean;
  error?: string;
};

export default function AuthControls({
  nextPath = "/",
}: AuthControlsProps) {
  const supabase = useMemo(() => createClient(), []);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false);

  const buttonClassName =
    "relative inline-flex items-center justify-center overflow-hidden rounded-full border border-white/80 bg-white/88 px-5 py-2.5 text-sm font-semibold text-[#0f172a] shadow-[0_14px_30px_rgba(15,23,42,0.06),0_0_0_1px_rgba(255,255,255,0.34),0_0_24px_rgba(217,70,239,0.10)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-fuchsia-200/80 hover:bg-white hover:shadow-[0_18px_38px_rgba(15,23,42,0.08),0_0_0_1px_rgba(255,255,255,0.42),0_0_32px_rgba(217,70,239,0.16)] active:translate-y-0 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-70";

  async function refreshAdminAccess() {
    try {
      const response = await fetch("/api/admin/access", {
        method: "GET",
        cache: "no-store",
      });

      const json = (await response.json()) as AdminAccessResponse;

      if (!response.ok || !json.ok || !json.isAdmin) {
        setIsAdmin(false);
        return;
      }

      setIsAdmin(true);
    } catch {
      setIsAdmin(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(async ({ data, error }) => {
      if (!mounted) return;

      if (!error && data.user?.email) {
        setEmail(data.user.email);
        await refreshAdminAccess();
      } else {
        setEmail("");
        setIsAdmin(false);
      }

      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;

      setEmail(session?.user?.email || "");

      if (session?.user?.email) {
        await refreshAdminAccess();
      } else {
        setIsAdmin(false);
      }

      setLoading(false);
      setIsSigningIn(false);
      setIsSigningOut(false);
      setIsSwitchingAccount(false);
      setMenuOpen(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const handleGoogleSignIn = async (forceSelectAccount = false) => {
    if (loading || isSigningIn || isSigningOut || isSwitchingAccount) return;

    try {
      setIsSigningIn(true);

      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: forceSelectAccount
            ? { prompt: "select_account" }
            : undefined,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setIsSigningIn(false);
      setIsSwitchingAccount(false);
      alert(error instanceof Error ? error.message : "Failed to sign in.");
    }
  };

  const handleSwitchAccount = async () => {
    if (loading || isSigningIn || isSigningOut || isSwitchingAccount) return;

    try {
      setMenuOpen(false);
      setIsSwitchingAccount(true);

      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      await handleGoogleSignIn(true);
    } catch (error) {
      setIsSwitchingAccount(false);
      alert(error instanceof Error ? error.message : "Failed to switch account.");
    }
  };

  const handleSignOut = async () => {
    if (loading || isSigningIn || isSigningOut || isSwitchingAccount) return;

    try {
      setIsSigningOut(true);
      setMenuOpen(false);

      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      window.location.href = "/";
    } catch (error) {
      setIsSigningOut(false);
      alert(error instanceof Error ? error.message : "Failed to sign out.");
    }
  };

  if (!email) {
    return (
      <button
        type="button"
        onClick={() => handleGoogleSignIn(false)}
        disabled={loading || isSigningIn || isSigningOut || isSwitchingAccount}
        className={buttonClassName}
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
        <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
        <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />
        <span className="relative z-10">
          {isSigningIn ? "Signing in..." : loading ? "Checking login..." : "Sign in"}
        </span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {isAdmin ? (
        <Link
          href="/admin"
          className={`group relative hidden md:inline-flex ${buttonClassName}`}
          title="Open admin"
        >
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
          <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
          <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />
          <span className="relative z-10">Admin</span>
        </Link>
      ) : null}

      <div ref={menuRef} className="relative hidden md:block">
        <button
          type="button"
          onClick={() => setMenuOpen((value) => !value)}
          disabled={loading || isSigningIn || isSigningOut || isSwitchingAccount}
          className={`group relative inline-flex h-[42px] max-w-[240px] items-center gap-2 overflow-hidden rounded-full border border-white/80 bg-white/88 px-4 py-2 text-sm font-semibold text-[#0f172a] shadow-[0_14px_30px_rgba(15,23,42,0.06),0_0_0_1px_rgba(255,255,255,0.34),0_0_24px_rgba(217,70,239,0.10)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-fuchsia-200/80 hover:bg-white hover:shadow-[0_18px_38px_rgba(15,23,42,0.08),0_0_0_1px_rgba(255,255,255,0.42),0_0_32px_rgba(217,70,239,0.16)] active:translate-y-0 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-70`}
          title={email}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
          <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
          <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />
          <span className="relative z-10 truncate">{email}</span>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className={`relative z-10 h-4 w-4 shrink-0 transition-transform duration-200 ${
              menuOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {menuOpen ? (
          <div className="absolute right-0 top-[calc(100%+12px)] z-40 w-[280px] overflow-hidden rounded-2xl border border-white/70 bg-white/92 p-2 shadow-[0_22px_60px_rgba(15,23,42,0.16)] backdrop-blur-xl">
            <div className="rounded-xl bg-slate-50/90 px-3.5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                Signed in as
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                {email}
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <Link
                href="/history"
                className="flex w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                History
              </Link>

              <button
                type="button"
                onClick={handleSwitchAccount}
                disabled={loading || isSigningIn || isSigningOut || isSwitchingAccount}
                className="flex w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSwitchingAccount ? "Switching account..." : "Switch account"}
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                disabled={loading || isSigningIn || isSigningOut || isSwitchingAccount}
                className="flex w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSigningOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <Link
        href="/history"
        className={`group relative md:hidden ${buttonClassName}`}
        title={email}
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
        <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
        <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />
        <span className="relative z-10 truncate">{email}</span>
      </Link>
    </div>
  );
}
