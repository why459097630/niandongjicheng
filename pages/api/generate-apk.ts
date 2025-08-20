// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: true } }; // 明确启用 bodyParser

const VALID_TEMPLATES = new Set(['core-template', 'form-template', 'simple-template']);

function bad(res: NextApiResponse, error: string, extra: any = {}) {
  return res.status(400).json({ ok: false, error, ...extra });
}

async function readRawBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];
  // 兼容没有被 bodyParser 解析到的场景（比如客户端传了 utf-16 等导致失败）
  for await (const c of (req as any)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return raw; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method not allowed' });
    }

    // 鉴权
    const secret = req.headers['x-api-secret'];
    if (!secret || String(secret) !== process.env.X_API_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    // 统一把 body 拿出来（无论是已解析 JSON、字符串还是原始字节）
    let body: any = req.body;
    const isEmptyObj = body && typeof body === 'object' && Object.keys(body).length === 0;
    if (!body || typeof body === 'string' || isEmptyObj) {
      const raw = await readRawBody(req);
      if (typeof raw === 'string') {
        try { body = JSON.parse(raw); } catch { body = raw; }
      } else {
        body = raw;
      }
    }

    console.log('[generate-apk] headers:', req.headers);
    console.log('[generate-apk] body:', body);

    if (!body || typeof body !== 'object') {
      return bad(res, 'body must be JSON with { prompt, template }');
    }

    const { prompt, template } = body as { prompt?: string; template?: string };

    if (typeof prompt !== 'string' || prompt.trim().length < 20) {
      return bad(res, 'prompt is required and should be a descriptive sentence (>= 20 chars)');
    }

    if (typeof template !== 'string' || !VALID_TEMPLATES.has(template)) {
      return bad(res, `template must be one of ${Array.from(VALID_TEMPLATES).join(', ')}`);
    }

    // TODO: 这里触发 push-to-github 的逻辑（省略）
    // 为了验证链路，先回显
    return res.status(200).json({ ok: true, prompt: prompt.trim(), template });
  } catch (e: any) {
    console.error('[generate-apk] unhandled error', e);
    return res.status(500).json({ ok: false, error: e?.message || 'internal error' });
  }
}
