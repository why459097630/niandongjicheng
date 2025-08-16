export type { Template } from './types';
// app/lib/client.ts
export function fetchBuildStatus(rid: number | string) {
  if (!rid) throw new Error('MISSING_RUN_ID');
  return fetch(`/api/build/status/${rid}`, { method: 'GET', cache: 'no-store' });
}
