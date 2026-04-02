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
      setEmail(session?.user?.email || "");
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const handleGoogleSignIn = async () => {
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) {
      alert(error.message);
    }
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      return;
    }

    window.location.href = "/";
  };

  if (loading) {
    return (
      <button
        type="button"
        disabled
        className="rounded-full border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium tracking-[0.01em] text-[#475569] backdrop-blur opacity-70"
      >
        Checking login...
      </button>
    );
  }

  if (!email) {
    return (
      <button
        type="button"
        onClick={handleGoogleSignIn}
        className="rounded-full border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium tracking-[0.01em] text-[#475569] backdrop-blur transition hover:bg-white"
      >
        Continue with Google
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden max-w-[220px] truncate rounded-full border border-slate-200 bg-white/70 px-4 py-2 text-sm font-medium text-[#475569] backdrop-blur md:block">
        {email}
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-full border border-slate-200 bg-white/60 px-4 py-2 text-sm font-medium tracking-[0.01em] text-[#475569] backdrop-blur transition hover:bg-white"
      >
        Sign out
      </button>
    </div>
  );
}
