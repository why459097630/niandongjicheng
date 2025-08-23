// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Ok = { ok: true; note: string; githubStatus: number; githubBody?: any };
type Fail = { ok: false; error: string; detail?: any };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*'; // 你也可以填具体域名

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Fail>) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    // ---- 读取 env，允许 body 覆盖 ----
    const GH_OWNER = (req.body?.owner as string) || process.env.GH_OWNER;
    const GH_REPO  = (req.body?.repo as string)  || process.env.GH_REPO;
    const GH_BRANCH = (req.body?.branch as string) || process.env.GH_BRANCH || 'main';
    const GH_PAT   = process.env.GH_PAT; // 服务器上配置

    if (!GH_OWNER || !GH_REPO) {
      return res.status(400).json({ ok: false, error: 'Missing GH_OWNER or GH_REPO' });
    }
    if (!GH_PAT) {
      return res.status(400).json({ ok: false, error: 'Missing GH_PAT (server env)' });
    }

    // ---- 读取业务参数（模板 & 版本信息）----
    const template     = (req.body?.template as string) || 'form-template';
    const app_name     = (req.body?.app_name as string) || 'MyApp';
    const version_name = (req.body?.version_name as string) || '1.0.0';
    const version_code = (req.body?.version_code as string) || '1';
    const reason       = (req.body?.reason as string) || 'api';

    // ---- 调 GitHub repository_dispatch ----
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`;
    const payload = {
      event_type: 'generate-apk',
      client_payload: {
        template,
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        app_name,
        version_name,
        version_code,
        reason,
      },
    };

    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${GH_PAT}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
    });

    const text = await ghRes.text();
    let body: any = undefined;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }

    if (!ghRes.ok) {
      // 把 GitHub 的状态与信息直接返回给前端，避免只看到 500
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
      githubBody: body,
    });
  } catch (err: any) {
    console.error('API /generate-apk error:', err);
    return res.status(200).json({ ok: false, error: err?.message || 'Internal Error' });
  }
}
