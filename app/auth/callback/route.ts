import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  insertOperationLog,
  upsertCurrentUserProfile,
} from "@/lib/build/storage";

function pickDisplayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string | null {
  const metadata = user.user_metadata || {};

  if (typeof metadata.full_name === "string" && metadata.full_name.trim()) {
    return metadata.full_name.trim();
  }

  if (typeof metadata.name === "string" && metadata.name.trim()) {
    return metadata.name.trim();
  }

  if (typeof metadata.user_name === "string" && metadata.user_name.trim()) {
    return metadata.user_name.trim();
  }

  if (typeof user.email === "string" && user.email.trim()) {
    return user.email.trim();
  }

  return null;
}

function pickAvatarUrl(user: {
  user_metadata?: Record<string, unknown> | null;
}): string | null {
  const metadata = user.user_metadata || {};

  if (typeof metadata.avatar_url === "string" && metadata.avatar_url.trim()) {
    return metadata.avatar_url.trim();
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  let next = searchParams.get("next") ?? "/";

  if (!next.startsWith("/")) {
    next = "/";
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const provider =
          typeof user.app_metadata?.provider === "string" &&
          user.app_metadata.provider.trim()
            ? user.app_metadata.provider.trim()
            : "google";

        await upsertCurrentUserProfile(supabase, {
          displayName: pickDisplayName(user),
          avatarUrl: pickAvatarUrl(user),
          provider,
        });

        await insertOperationLog(supabase, {
          userId: user.id,
          eventName: "login_success",
          pagePath: "/auth/callback",
          metadata: {
            next,
            provider,
          },
        });
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
