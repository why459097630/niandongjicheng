// /pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type BodyIn = {
  template?: string;
  appName?: string;
  apiBase?: string;
  apiSecret?: string;
};

// CORS 头（便于你本地或跨域调试）
function corsHeaders() {
  const origin = process.env.ALLOW_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-api-secret',
  };
}

function send(
  res: NextApiResponse,
  status: number,
  data: Record<string, any>
) {
  res.status(status).setHeader('Vary', 'Origin');
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  res.json(data);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 处理预检
  if (req.method === 'OPTIONS') {
    res.status(204);
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  // ——密钥校验（可选）——
  // • 推荐只设置 X_API_SECRET（服务端可见）；兼容你之前的 NEXT_PUBLIC_X_API_SECRET；
  // • 两者都没设置则不做校验（不会 401）。
  const envSecret =
    (process.env.X_API_SECRET ?? '').trim() ||
    (process.env.NEXT_PUBLIC_X_API_SECRET ?? '').trim();

  const headerSecret =
    (req.headers['x-api-secret'] as string | undefined)?.trim() || '';

  if (envSecret && headerSecret !== envSecret) {
    return send(res, 401, { ok: false, error: 'Unauthorized: secret mismatch' });
  }

  // 解析并校验 body
  const body = (req.body ?? {}) as BodyIn;

  const template = (body.template ?? '').trim();
  const appName = (body.appName ?? '').trim();
  const apiBase = (body.apiBase ?? '').trim();
  const apiSecret = (body.apiSecret ?? '').trim();

  const miss: string[] = [];
  if (!template) miss.push('template');
  if (!appName) miss.push('appName');
  if (!apiBase) miss.push('apiBase');
  if (!apiSecret) miss.push('apiSecret');

  if (miss.length) {
    return send(res, 400, {
      ok: false,
      error: 'Missing required fields',
      missing: miss,
    });
  }

  // 读取 GitHub 配置（Vercel 环境变量）
  const GH_OWNER = (process.env.GH_OWNER ?? '').trim();
  const GH_REPO = (process.env.GH_REPO ?? '').trim();
  const GH_TOKEN =
    (process.env.GH_PAT ?? '').trim() || (process.env.GH_TOKEN ?? '').trim();

  if (!GH_OWNER || !GH_REPO || !GH_TOKEN) {
    return send(res, 500, {
      ok: false,
      error: 'GitHub env missing',
      need: ['GH_OWNER', 'GH_REPO', 'GH_TOKEN (or GH_PAT)'],
    });
  }

  // 触发 repository_dispatch
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(
        GH_REPO
      )}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${GH_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: 'generate-apk',
          client_payload: {
            template,
            app_name: appName,
            api_base: apiBase,
            api_secret: apiSecret,
          },
        }),
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return send(res, resp.status, {
        ok: false,
        error: 'GitHub dispatch failed',
        status: resp.status,
        body: text,
      });
    }

    // 一切正常
    return send(res, 202, {
      ok: true,
      message: 'repository_dispatch sent',
      event_type: 'generate-apk',
      payload: { template, appName, apiBase },
    });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
