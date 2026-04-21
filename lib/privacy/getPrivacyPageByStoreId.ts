import { createAdminClient } from "@/lib/supabase/admin";

export type PrivacyPageRecord = {
  storeId: string;
  appName: string;
  merchantEmail: string;
  effectiveDate: string;
};

type PrivacyPageRow = {
  store_id: string;
  app_name: string;
  merchant_email: string;
  effective_date: string;
};

function normalizeDate(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 10);
}

export async function getPrivacyPageByStoreId(
  storeId: string,
): Promise<PrivacyPageRecord | null> {
  const normalizedStoreId = storeId.trim();
  if (!normalizedStoreId) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("privacy_pages")
    .select("store_id, app_name, merchant_email, effective_date")
    .eq("store_id", normalizedStoreId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load privacy page data.");
  }

  if (!data) {
    return null;
  }

  const row = data as PrivacyPageRow;

  return {
    storeId: row.store_id,
    appName: row.app_name,
    merchantEmail: row.merchant_email,
    effectiveDate: normalizeDate(row.effective_date),
  };
}