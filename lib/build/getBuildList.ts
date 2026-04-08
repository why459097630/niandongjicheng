import type { SupabaseClient } from "@supabase/supabase-js";
import { listBuildRecordsByUser } from "./storage";
import { BuildHistoryItem, BuildListResponse, CloudServiceStatus } from "./types";

type StoreLifecycleRow = {
  store_id: string;
  service_status: CloudServiceStatus;
  is_write_allowed: boolean;
  service_end_at: string | null;
  delete_at: string | null;
};

export async function getBuildList(
  supabase: SupabaseClient,
  userId: string,
): Promise<BuildListResponse> {
  const records = await listBuildRecordsByUser(supabase, userId);

  const storeIds = Array.from(
    new Set(
      records
        .map((record) => record.storeId)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  );

  let storeMap = new Map<string, StoreLifecycleRow>();

  if (storeIds.length > 0) {
    const { data: stores, error: storesError } = await supabase
      .from("stores")
      .select("store_id, service_status, is_write_allowed, service_end_at, delete_at")
      .in("store_id", storeIds);

    if (storesError) {
      throw new Error(storesError.message);
    }

    storeMap = new Map(
      ((stores || []) as StoreLifecycleRow[]).map((store) => [store.store_id, store]),
    );
  }

  const items: BuildHistoryItem[] = records.map((record) => {
    const store = record.storeId ? storeMap.get(record.storeId) : undefined;

    return {
      runId: record.runId,
      appName: record.appName,
      stage: record.status,
      createdAt: record.createdAt,
      completedAt: record.completedAt ?? null,
      failedStep: record.failedStep ?? null,
      storeId: record.storeId ?? null,
      moduleName: record.moduleName,
      uiPackName: record.uiPackName,
      mode: record.mode,
      downloadUrl: record.downloadUrl,
      cloudStatus: store?.service_status,
      cloudExpiresAt: store?.service_end_at ?? null,
      cloudDeletesAt: store?.delete_at ?? null,
      isWriteAllowed: store?.is_write_allowed,
    };
  });

  return {
    ok: true,
    items,
  };
}