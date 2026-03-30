import { InternalBuildRecord } from "./types";

type BuildStore = {
  records: Map<string, InternalBuildRecord>;
};

declare global {
  // eslint-disable-next-line no-var
  var __ndjcBuildStore__: BuildStore | undefined;
}

function createStore(): BuildStore {
  return {
    records: new Map<string, InternalBuildRecord>(),
  };
}

export function getBuildStore(): BuildStore {
  if (!globalThis.__ndjcBuildStore__) {
    globalThis.__ndjcBuildStore__ = createStore();
  }

  return globalThis.__ndjcBuildStore__;
}

export function upsertBuildRecord(record: InternalBuildRecord): void {
  const store = getBuildStore();
  store.records.set(record.runId, record);
}

export function getBuildRecord(runId: string): InternalBuildRecord | null {
  const store = getBuildStore();
  return store.records.get(runId) ?? null;
}

export function listBuildRecords(): InternalBuildRecord[] {
  const store = getBuildStore();
  return Array.from(store.records.values()).sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}