// /pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Body = {
  template?: string;
  appName?: string;
  apiBase?: string;
  apiSecret?: string;
};

const EVENT_TYPE = 'generate-apk';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    // 1) 可选的 header 验证（与 Vercel 环境变量 NEXT_PUBLIC_X_API_SECRET 一致）
    const must = process.env.NEXT_PUBLIC_X_API_SECRET || '';
    if (must) {
      const headerSecret = (req.headers['x-api-secret'] as string) || '';
      if (headerSecret !== must) {
        return res.status(401).json({ ok: false, error: 'Unauthorized: secret mismatch' });
      }
    }

    // 2) 解析 JSON
    const raw = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const body = raw as Body;

    const template  = (body.template  ?? '').toString().trim();
    const appName   = (body.appName   ?? '').toString().trim();
    const apiBase   = (body.apiBase   ?? '').toString().trim();
    const apiSecret = (body.apiSecret ?? '').toString().trim();

    // 3) 必填校验（apiSecret 可按需改为必填）
    const miss: string[] = [];
    if (!template) miss.push('template');
    if (!appName)  miss.push('appName');
    if (!apiBase)  miss.push('apiBase');

    if (miss.length) {
      return res.status(400).json({ ok: false, error: `Missing fields: ${miss.join(', ')}` });
    }

    // 4) 读取 GitHub 凭据
    const OWNER = process.env.GH_OWNER || '';
    const REPO  = process.env.GH_REPO  || '';
    const TOKEN = process.env.GH_TOKEN || '';

    if (!OWNER || !REPO || !TOKEN) {
      return res.status(500).json({
        ok: false,
        error: 'Server not configured (GH_OWNER / GH_REPO / GH_TOKEN)',
      });
    }

    // 5) 调 GitHub repository_dispatch
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/dispatches`;
    const payload = {
      event_type: EVENT_TYPE,
      client_payload: {
        template,
        app_name: appName,
        api_base: apiBase,
        api_secret: apiSecret,
      },
    };

    const gh = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': `${OWNER}-${REPO}-generate-apk`,
        'Content-Type': 'application/json',
      } as any,
      body: JSON.stringify(payload),
    });

    if (!gh.ok) {
      const text = await gh.text();
      return res.status(502).json({
        ok: false,
        error: 'github_dispatch_failed',
        status: gh.status,
        body: text,
      });
    }

    // 6) 成功
    return res
      .status(202)
      .json({ ok: true, message: 'dispatched', payload: { template, appName } });
  } catch (err: any) {
    console.error('[generate-apk] error:', err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || 'internal_error' });
  }
}
