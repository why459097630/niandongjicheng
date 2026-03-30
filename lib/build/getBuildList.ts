import { listBuildRecords } from "./storage";
import { BuildHistoryItem, BuildListResponse } from "./types";

export function getBuildList(): BuildListResponse {
  const items: BuildHistoryItem[] = listBuildRecords().map((record) => ({
    runId: record.runId,
    appName: record.appName,
    stage:
      record.status === "success"
        ? "success"
        : record.status === "failed"
          ? "failed"
          : record.status === "running"
            ? "running"
            : "queued",
    createdAt: record.createdAt,
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
