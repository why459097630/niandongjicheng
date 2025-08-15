// app/api/build/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER = 'why459097630';
const REPO  = 'Packaging-warehouse';
// 用工作流文件名也可以触发（等同于用 workflow id）
const WORKFLOW_FILE = 'android-build-matrix.yml';

type Template = 'core-template' | 'simple-template' | 'form-template';

class HttpError extends Error { status: number; code: string;
  constructor(status: number, message: string, code = 'error') { super(message); this.status = status; this.code = code; }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

// —— 轻量来源校验（可选）：Vercel 环境变量 ALLOW_ORIGIN="https://你的域名,https://其他域名"
function enforceOrigin(req: Request) {
  const allow = (process.env.ALLOW_ORIGIN || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length === 0) return;
  const origin  = req.headers.get('origin')   || '';
  const referer = req.headers.get('referer')  || '';
  const pass = allow.some(a => origin.startsWith(a) || referer.startsWith(a));
  if (!pass) throw new HttpError(403, 'Forbidden origin', 'forbidden_origin');
}

// —— 简易限流（每 IP+路径 60s 内最多 6 次）
const bucket = new Map<string, { c: number; ts: number }>();
function rateLimit(req: Request, limit = 6, windowMs = 60_000) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ip';
  const key = `${ip}:${new URL(req.url).pathname}`;
  const now = Date.now();
  const rec = bucket.get(key) ?? { c: 0, ts: now };
  if (now - rec.ts > windowMs) { rec.c = 0; rec.ts = now; }
  rec.c += 1; bucket.set(key, rec);
  if (rec.c > limit) throw new HttpError(429, 'Too Many Requests', 'rate_limited');
}

export async function POST(req: Request) {
  try {
    enforceOrigin(req);
    rateLimit(req);

    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) throw new HttpError(500, 'GITHUB_TOKEN missing', 'token_missing');

    const body = await req.json().catch(() => ({}));
    const template: Template = (body?.template || 'core-template') as Template;

    // 触发 workflow_dispatch（最多重试 3 次，指数回退）
    const payload = { ref: 'main', inputs: { template } };
    let lastErr: any = null;
    for (let i = 0, backoff = 500; i < 3; i++, backoff *= 2) {
      const r = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${token}`,
            'accept': 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );
      if (r.status === 204) {
        return json({ ok: true, dispatched: template });
      }
      lastErr = await r.text().catch(() => r.statusText);
      await new Promise(res => setTimeout(res, backoff));
    }
    throw new HttpError(502, `dispatch failed: ${lastErr || 'unknown'}`, 'dispatch_failed');
  } catch (e: any) {
    const status = e?.status || 500;
    return json({ ok: false, code: e?.code || 'server_error', message: e?.message || 'server_error' }, status);
  }
}
