export type ReleaseAsset = { name: string; browser_download_url: string };

export async function dispatchBuild(body: { template: string; prompt?: string }) {
  const r = await fetch('/api/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('dispatch failed');
  return r.json();
}

export async function getBuildStatus() {
  const r = await fetch('/api/build/status', { cache: 'no-store' });
  if (!r.ok) throw new Error('status failed');
  return r.json();
}

export async function getLatestRelease() {
  const r = await fetch('/api/release/latest', { cache: 'no-store' });
  if (!r.ok) throw new Error('release failed');
  return r.json();
}

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
