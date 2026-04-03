import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  insertOperationLogOnce,
  syncAuthUserProfile,
} from "@/lib/build/storage";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  let next = searchParams.get("next") ?? "/";

  if (!next.startsWith("/")) {
    next = "/";
  }

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        try {
          await syncAuthUserProfile(supabase, user);
        } catch (profileError) {
          console.error("NDJC callback: failed to sync profile", profileError);
        }

        try {
          await insertOperationLogOnce(
            supabase,
            {
              userId: user.id,
              eventName: "login_success",
              pagePath: "/auth/callback",
              metadata: {
                next,
                provider:
                  typeof user.app_metadata?.provider === "string" &&
                  user.app_metadata.provider.trim()
                    ? user.app_metadata.provider.trim()
                    : "google",
              },
            },
            { dedupeSeconds: 20 },
          );
        } catch (logError) {
          console.error("NDJC callback: failed to write login_success log", logError);
        }
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

    try {
      await insertOperationLogOnce(
        supabase,
        {
          userId: "00000000-0000-0000-0000-000000000000",
          eventName: "auth_callback_failed",
          pagePath: "/auth/callback",
          metadata: {
            next,
            reason: error.message,
          },
        },
        { dedupeSeconds: 20 },
      );
    } catch (logError) {
      console.error("NDJC callback: failed to write auth_callback_failed log", logError);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
