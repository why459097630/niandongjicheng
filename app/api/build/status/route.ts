// app/api/build/status/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER = 'why459097630';
const REPO  = 'Packaging-warehouse';
const WORKFLOW_FILE = 'android-build-matrix.yml';

class HttpError extends Error { status: number; code: string;
  constructor(status: number, message: string, code = 'error') { super(message); this.status = status; this.code = code; }
}
function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
function enforceOrigin(req: Request) {
  const allow = (process.env.ALLOW_ORIGIN || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length === 0) return;
  const origin  = req.headers.get('origin')   || '';
  const referer = req.headers.get('referer')  || '';
  const pass = allow.some(a => origin.startsWith(a) || referer.startsWith(a));
  if (!pass) throw new HttpError(403, 'Forbidden origin', 'forbidden_origin');
}
const bucket = new Map<string, { c: number; ts: number }>();
function rateLimit(req: Request, limit = 20, windowMs = 60_000) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ip';
  const key = `${ip}:${new URL(req.url).pathname}`;
  const now = Date.now();
  const rec = bucket.get(key) ?? { c: 0, ts: now };
  if (now - rec.ts > windowMs) { rec.c = 0; rec.ts = now; }
  rec.c += 1; bucket.set(key, rec);
  if (rec.c > limit) throw new HttpError(429, 'Too Many Requests', 'rate_limited');
}

export async function GET(req: Request) {
  try {
    enforceOrigin(req);
    rateLimit(req, 20);

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) throw new HttpError(500, 'GITHUB_TOKEN missing', 'token_missing');

    const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`;
    const r = await fetch(url, {
      headers: {
        'authorization': `Bearer ${token}`,
        'accept': 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      }
    });

    if (!r.ok) throw new HttpError(r.status, `github api ${r.status}`, 'github_error');

    const data = await r.json();
    const run = (data?.workflow_runs?.[0]) || {};
    const status = run.status || 'queued';
    const conclusion = run.conclusion ?? null;

    return json({ ok: true, run: { status, conclusion } });
  } catch (e: any) {
    const status = e?.status || 500;
    return json({ ok: false, code: e?.code || 'server_error', message: e?.message || 'server_error' }, status);
  }
}
