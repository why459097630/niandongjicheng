import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.WEB_SUPABASE_URL!,
    process.env.WEB_SUPABASE_PUBLISHABLE_KEY!,
  );
}