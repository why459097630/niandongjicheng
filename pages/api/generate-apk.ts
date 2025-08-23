// /pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type BodyIn = {
  template?: string;
  appName?: string;
  apiBase?: string;
  apiSecret?: string;
  xApiSecret?: string;   // 兼容：把密钥放 body
  x_api_secret?: string; // 兼容：把密钥放 body（下划线）
};

function corsHeaders() {
  const origin = process.env.ALLOW_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-api-secret',
  };
}

function send(res: NextApiResponse, status: number, data: Record<string, any>) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(status).json(data);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  // ---------- 密钥校验（更宽松 + 可关闭） ----------
  const disableCheck = ['1', 'true', 'yes'].includes(
    (process.env.DISABLE_SECRET_CHECK ?? '').toLowerCase()
  );

  // 环境侧密钥：优先 X_API_SECRET，其次兼容 NEXT_PUBLIC_X_API_SECRET
  const envSecret =
    (process.env.X_API_SECRET ?? '').trim() ||
    (process.env.NEXT_PUBLIC_X_API_SECRET ?? '').trim();

  // 请求侧密钥：header / body / query 三路回退，谁有用谁
  const headerSecretRaw = (req.headers['x-api-secret'] as string | string[] | undefined) ?? '';
  const headerSecret = Array.isArray(headerSecretRaw) ? headerSecretRaw[0] : headerSecretRaw;

  const body = (req.body ?? {}) as BodyIn;
  const bodySecret =
    (body.xApiSecret ?? body.x_api_secret ?? body.apiSecret ?? '').toString();

  const querySecret = (req.query?.x_api_secret ?? '').toString();

  const incomingSecret = (headerSecret || bodySecret || querySecret).trim();

  if (!disableCheck && envSecret && incomingSecret !== envSecret) {
    // 401 调试信息（不暴露明文）
    return send(res, 401, {
      ok: false,
      error: 'Unauthorized: secret mismatch',
      debug: {
        // 仅用于排查：是否带了 header / body / query；长度是否为 0
        envSecretPresent: Boolean(envSecret),
        envSecretLen: envSecret.length,
        incomingFrom: headerSecret ? 'header' : bodySecret ? 'body' : querySecret ? 'query' : 'none',
        incomingLen: incomingSecret.length,
        // 若你想忽略校验测试，把 DISABLE_SECRET_CHECK 设为 1
        howToBypass: 'set env DISABLE_SECRET_CHECK=1 to bypass temporarily',
      },
    });
  }

  // ---------- 参数校验 ----------
  const template = (body.template ?? '').trim();
  const appName  = (body.appName  ?? '').trim();
  const apiBase  = (body.apiBase  ?? '').trim();
  const apiSecret = (body.apiSecret ?? '').trim();

  const miss: string[] = [];
  if (!template) miss.push('template');
  if (!appName)  miss.push('appName');
  if (!apiBase)  miss.push('apiBase');
  if (!apiSecret) miss.push('apiSecret');
  if (miss.length) {
    return send(res, 400, { ok: false, error: 'Missing required fields', missing: miss });
  }

  // ---------- GitHub 配置 ----------
  const GH_OWNER = (process.env.GH_OWNER ?? '').trim();
  const GH_REPO  = (process.env.GH_REPO  ?? '').trim();
  const GH_TOKEN =
    (process.env.GH_PAT ?? '').trim() || (process.env.GH_TOKEN ?? '').trim();

  if (!GH_OWNER || !GH_REPO || !GH_TOKEN) {
    return send(res, 500, {
      ok: false,
      error: 'GitHub env missing',
      need: ['GH_OWNER', 'GH_REPO', 'GH_TOKEN (or GH_PAT)'],
    });
  }

  // ---------- 触发 repository_dispatch ----------
  try {
    const gh = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(GH_OWNER)}/${encodeURIComponent(GH_REPO)}/dispatches`,
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

    if (!gh.ok) {
      const text = await gh.text();
      return send(res, gh.status, {
        ok: false,
        error: 'GitHub dispatch failed',
        status: gh.status,
        body: text,
      });
    }

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
