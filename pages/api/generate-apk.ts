// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// Response types
type Ok   = { ok: true; note: string; githubStatus: number; payloadSent: any; githubBody?: any };
type Fail = { ok: false; error: string; detail?: any };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// Small helpers
const pickHeader = (req: NextApiRequest, name: string): string => {
  const v = req.headers[name.toLowerCase()];
  if (!v) return '';
  return Array.isArray(v) ? v[0] : v;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Ok | Fail>
) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    // --- GitHub repository / auth ---
    const GH_OWNER  = (req.body?.owner  as string) || process.env.GH_OWNER || '';
    const GH_REPO   = (req.body?.repo   as string) || process.env.GH_REPO  || '';
    const GH_BRANCH = (req.body?.branch as string) || process.env.GH_BRANCH || 'main';
    const GH_PAT    = process.env.GH_PAT || '';

    if (!GH_OWNER || !GH_REPO) return res.status(400).json({ ok: false, error: 'Missing GH_OWNER or GH_REPO' });
    if (!GH_PAT)               return res.status(400).json({ ok: false, error: 'Missing GH_PAT (server env)' });

    // --- Inputs ---
    // Allow both snake_case and camelCase. Fallback to envs if request body is empty.
    const template     = (req.body?.template     as string) || 'form-template';
    const app_name     = (req.body?.app_name     as string) || (req.body?.appName     as string) || 'MyApp';
    const version_name = (req.body?.version_name as string) || '1.0.0';
    const version_code = (req.body?.version_code as string) || '1';
    const reason       = (req.body?.reason       as string) || 'api';

    const api_base = (
      (req.body?.api_base   as string) ||
      (req.body?.apiBase    as string) ||
      process.env.API_BASE ||
      process.env.NEXT_PUBLIC_API_BASE ||
      ''
    ).toString().trim();

    const api_secret = (
      pickHeader(req, 'x-api-secret') ||
      (req.body?.api_secret as string) ||
      (req.body?.apiSecret as string) ||
      process.env.API_SECRET ||
      process.env.X_API_SECRET ||
      process.env.NEXT_PUBLIC_X_API_SECRET ||
      ''
    ).toString().trim();

    // Debug logs (mask secret)
    console.log('[API] raw body =', JSON.stringify(req.body || {}));

    const client_payload = {
      template,
      app_name,
      api_base,
      api_secret, // NOTE: keep in payload; Action will validate; logs below are masked
      owner: GH_OWNER,
      repo: GH_REPO,
      branch: GH_BRANCH,
      version_name,
      version_code,
      reason,
    };

    console.log('[API] payload to GitHub =', JSON.stringify({
      ...client_payload,
      api_secret: api_secret ? '***' : '',
    }));

    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`;
    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${GH_PAT}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: 'generate-apk', client_payload }),
    });

    const text = await ghRes.text();
    let body: any = undefined;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }

    if (!ghRes.ok) {
      return res.status(200).json({
        ok: false,
        error: 'GitHub dispatch failed',
        detail: { status: ghRes.status, body },
      });
    }

    return res.status(200).json({
      ok: true,
      note: 'repository_dispatch sent',
      githubStatus: ghRes.status,
      payloadSent: { ...client_payload, api_secret: api_secret ? '***' : '' }, // echo (masked)
      githubBody: body,
    });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: err?.message || 'Internal Error' });
  }
}
