import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const supabaseUrl =
    process.env.WEB_SUPABASE_URL?.trim() || "";

  const serviceRoleKey =
    process.env.WEB_SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

  if (!supabaseUrl) {
    throw new Error("Missing WEB_SUPABASE_URL.");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing WEB_SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}