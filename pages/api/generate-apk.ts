// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }
    if (req.headers['content-type']?.includes('application/json') !== true) {
      return res.status(415).json({ ok: false, error: 'Content-Type must be application/json' });
    }
    // 简单白名单校验（可按需关闭）
    if (process.env.X_API_SECRET && req.headers['x-api-secret'] !== process.env.X_API_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const raw = req.body ?? {};
    // 兼容驼峰/蛇形，统一成工作流要的蛇形
    const payload = {
      template:   raw.template   ?? '',
      app_name:   raw.app_name   ?? raw.appName   ?? '',
      api_base:   raw.api_base   ?? raw.apiBase   ?? '',
      api_secret: raw.api_secret ?? raw.apiSecret ?? '',
    };

    const missing = Object.entries(payload).filter(([_, v]) => !v).map(([k]) => k);
    if (missing.length) {
      return res.status(400).json({ ok: false, error: 'Missing fields', missing, got: raw });
    }

    const owner = process.env.GH_OWNER!;
    const repo  = process.env.GH_REPO!;
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.GH_PAT!}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type: 'generate-apk',
        client_payload: payload
      })
    });

    const ghText = await ghRes.text(); // GitHub 多数返回 204(空)
    return res.status(ghRes.ok ? 200 : 502).json({
      ok: ghRes.ok,
      ghStatus: ghRes.status,
      sent: { ...payload, api_secret: '[hidden]' }, // 别回显明文
      ghBody: ghText || null
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
