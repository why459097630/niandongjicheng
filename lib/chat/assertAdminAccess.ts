import { createClient as createServerClient } from "@/lib/supabase/server";

export async function assertAdminAccess() {
  const authClient = await createServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized.",
      user: null,
    };
  }

  const emailAllowlistRaw =
    process.env.ADMIN_EMAIL_ALLOWLIST?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    "";

  const userIdAllowlistRaw = process.env.ADMIN_USER_IDS?.trim() || "";

  const emailAllowlist = emailAllowlistRaw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const userIdAllowlist = userIdAllowlistRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const currentEmail = (user.email || "").trim().toLowerCase();
  const currentUserId = user.id;

  if (userIdAllowlist.length > 0) {
    const userIdMatched = !!currentUserId && userIdAllowlist.includes(currentUserId);

    if (!userIdMatched) {
      return {
        ok: false as const,
        status: 403,
        error: "Forbidden.",
        user: null,
      };
    }

    return {
      ok: true as const,
      status: 200,
      error: null,
      user,
    };
  }

  if (emailAllowlist.length > 0) {
    const emailMatched = !!currentEmail && emailAllowlist.includes(currentEmail);

    if (!emailMatched) {
      return {
        ok: false as const,
        status: 403,
        error: "Forbidden.",
        user: null,
      };
    }

    return {
      ok: true as const,
      status: 200,
      error: null,
      user,
    };
  }

  return {
    ok: false as const,
    status: 403,
    error: "Forbidden.",
    user: null,
  };
}