import type { Template } from './pickTemplate';

export type DispatchResp = { ok: boolean; dispatched: Template };
export type BuildStatus = {
  ok: boolean;
  run: { status: 'queued' | 'in_progress' | 'completed'; conclusion?: string };
};
export type ReleaseAsset = { name: string; browser_download_url: string };
export type LatestRelease = { ok: boolean; tag: string; assets: ReleaseAsset[] };

export async function dispatchBuild(template: Template): Promise<DispatchResp> {
  const r = await fetch('/api/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template })
  });
  if (!r.ok) throw new Error(`dispatch failed: ${r.status}`);
  return r.json();
}

export async function getBuildStatus(): Promise<BuildStatus> {
  const r = await fetch('/api/build/status', { cache: 'no-store' });
  if (!r.ok) throw new Error(`status failed: ${r.status}`);
  return r.json();
}

export async function getLatestRelease(): Promise<LatestRelease> {
  const r = await fetch('/api/release/latest', { cache: 'no-store' });
  if (!r.ok) throw new Error(`release failed: ${r.status}`);
  return r.json();
}

export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
