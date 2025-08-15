import type { NextApiRequest, NextApiResponse } from 'next';

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// 允许来源：Vercel 环境变量 ALLOW_ORIGIN="https://niandongjicheng.vercel.app,https://xxx.com"
export function enforceOrigin(req: NextApiRequest) {
  const allows = (process.env.ALLOW_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (allows.length === 0) return; // 未配置则不校验
  const origin = (req.headers.origin as string) || '';
  const referer = (req.headers.referer as string) || '';
  const pass = allows.some(a => origin.startsWith(a) || referer.startsWith(a));
  if (!pass) throw new HttpError(403, 'Forbidden origin', 'forbidden_origin');
}

// 简易限流：每 IP+路径 每 60s 允许 6 次（多实例下只是轻防护）
const bucket = new Map<string, { c: number; ts: number }>();
export function rateLimit(req: NextApiRequest, limit = 6, windowMs = 60_000) {
  const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'ip')
    .split(',')[0].trim();
  const key = `${ip}:${req.url}`;
  const now = Date.now();

  const rec = bucket.get(key) ?? { c: 0, ts: now };
  if (now - rec.ts > windowMs) { rec.c = 0; rec.ts = now; }
  rec.c += 1;
  bucket.set(key, rec);

  if (rec.c > limit) throw new HttpError(429, 'Too Many Requests', 'too_many_requests');
}

export function ok<T>(res: NextApiResponse, data: T) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, ...data });
}

export function fail(res: NextApiResponse, e: any) {
  const status = e instanceof HttpError ? e.status : 500;
  const code = e instanceof HttpError ? e.code : 'server_error';
  const msg  = e?.message || 'server_error';
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({ ok: false, code, message: msg });
}
