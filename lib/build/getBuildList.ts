import type { SupabaseClient } from "@supabase/supabase-js";
import { countBuildRecordsByUser, listBuildRecordsByUser } from "./storage";
import { BuildHistoryItem, BuildListResponse, BuildStatusValue } from "./types";

type GetBuildListOptions = {
  limit?: number;
  offset?: number;
  status?: BuildStatusValue[];
};

export async function getBuildList(
  supabase: SupabaseClient,
  userId: string,
  options: GetBuildListOptions = {},
): Promise<BuildListResponse> {
  const [records, totalCount] = await Promise.all([
    listBuildRecordsByUser(supabase, userId, {
      limit: options.limit,
      offset: options.offset,
      status: options.status,
    }),
    countBuildRecordsByUser(supabase, userId, {
      status: options.status,
    }),
  ]);

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
    releaseUrl: record.releaseUrl,
    publicApkUrl: record.publicApkUrl,
  }));

  return {
    ok: true,
    items,
    totalCount,
  };
}