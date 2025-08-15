// app/lib/client.ts
export type Template = 'core-template' | 'simple-template' | 'form-template';

export type DispatchResp = { ok: boolean; dispatched: Template };
export type BuildStatus = { run: { status: 'queued'|'in_progress'|'completed'; conclusion?: 'success'|'failure'|'cancelled' } };
export type ReleaseAsset = { name: string; browser_download_url: string };
export type LatestRelease = { tag: string; assets: ReleaseAsset[] };

async function j<T>(url: string, init?: RequestInit, timeout = 20_000): Promise<T> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, { ...init, signal: c.signal });
    if (!r.ok) throw new Error(await r.text().catch(() => r.statusText));
    return r.json() as Promise<T>;
  } finally {
    clearTimeout(t);
  }
}

export function dispatchBuild(template: Template) {
  return j<DispatchResp>('/api/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
}

export function getBuildStatus() {
  return j<BuildStatus>('/api/build/status', { method: 'GET' }, 15_000);
}

export function getLatestRelease() {
  return j<LatestRelease>('/api/release/latest', { method: 'GET' }, 15_000);
}
