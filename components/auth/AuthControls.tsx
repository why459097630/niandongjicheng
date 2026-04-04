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
    "inline-flex items-center rounded-full border border-white/70 bg-white/92 px-5 py-2.5 text-sm font-semibold text-[#0f172a] shadow-[0_12px_26px_rgba(15,23,42,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_30px_rgba(15,23,42,0.09)] disabled:cursor-not-allowed disabled:opacity-70";

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
        {isSigningIn ? "Signing in..." : loading ? "Checking login..." : "Sign in"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div
        className={`hidden max-w-[220px] truncate md:inline-flex ${buttonClassName}`}
        title={email}
      >
        {email}
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading || isSigningIn || isSigningOut}
        className={buttonClassName}
      >
        {isSigningOut ? "Signing out..." : "Sign out"}
      </button>
    </div>
  );
}
