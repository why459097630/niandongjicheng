import type { SupabaseClient } from "@supabase/supabase-js";
import { listBuildRecordsByUser } from "./storage";
import { BuildHistoryItem, BuildListResponse } from "./types";

export async function getBuildList(
  supabase: SupabaseClient,
  userId: string,
): Promise<BuildListResponse> {
  const records = await listBuildRecordsByUser(supabase, userId);

  const items: BuildHistoryItem[] = records.map((record) => ({
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
  }));

  return {
    ok: true,
    items,
  };
}
