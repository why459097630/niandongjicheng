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

  const allowlistRaw =
    process.env.ADMIN_EMAIL_ALLOWLIST?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    "";

  const allowlist = allowlistRaw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const currentEmail = (user.email || "").trim().toLowerCase();

  if (!currentEmail || allowlist.length === 0 || !allowlist.includes(currentEmail)) {
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