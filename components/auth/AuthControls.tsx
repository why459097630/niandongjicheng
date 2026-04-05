"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AuthControlsProps = {
  nextPath?: string;
};

export default function AuthControls({
  nextPath = "/",
}: AuthControlsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const buttonClassName =
    "relative inline-flex items-center justify-center overflow-hidden rounded-full border border-white/80 bg-white/88 px-5 py-2.5 text-sm font-semibold text-[#0f172a] shadow-[0_14px_30px_rgba(15,23,42,0.06),0_0_0_1px_rgba(255,255,255,0.34),0_0_24px_rgba(217,70,239,0.10)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-fuchsia-200/80 hover:bg-white hover:shadow-[0_18px_38px_rgba(15,23,42,0.08),0_0_0_1px_rgba(255,255,255,0.42),0_0_32px_rgba(217,70,239,0.16)] active:translate-y-0 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-70";

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;

      if (!error && data.user?.email) {
        setEmail(data.user.email);
      } else {
        setEmail("");
      }

      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setEmail(session?.user?.email || "");
      setLoading(false);
      setIsSigningIn(false);
      setIsSigningOut(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleGoogleSignIn = async () => {
    if (loading || isSigningIn || isSigningOut) return;

    try {
      setIsSigningIn(true);

      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
        },
      });

      if (error) {
        throw error;
      }
    } catch (error) {
      setIsSigningIn(false);
      alert(error instanceof Error ? error.message : "Failed to sign in.");
    }
  };

  const handleSignOut = async () => {
    if (loading || isSigningIn || isSigningOut) return;

    try {
      setIsSigningOut(true);

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
        onClick={handleGoogleSignIn}
        disabled={loading || isSigningIn || isSigningOut}
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
      <div
        className={`group relative hidden max-w-[220px] truncate md:inline-flex ${buttonClassName}`}
        title={email}
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
        <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
        <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />
        <span className="relative z-10 truncate">{email}</span>
      </div>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading || isSigningIn || isSigningOut}
        className={`${buttonClassName} group`}
      >
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_42%,rgba(217,70,239,0.08)_100%)] opacity-100" />
        <span className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.18)_100%)] opacity-80" />
        <span className="pointer-events-none absolute -left-10 top-0 h-full w-12 rotate-[18deg] bg-white/45 blur-md transition-all duration-500 group-hover:translate-x-[160%]" />
        <span className="relative z-10">
          {isSigningOut ? "Signing out..." : "Sign out"}
        </span>
      </button>
    </div>
  );
}