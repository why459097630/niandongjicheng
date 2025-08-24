// pages/api/generate-apk.ts  ——在你“可正常触发”的版本上增加这块即可
import type { NextApiRequest, NextApiResponse } from 'next';

type Ok   = { ok: true; note: string; githubStatus: number; payloadSent: any; trace_id: string; githubBody?: any };
type Fail = { ok: false; error: string; detail?: any; trace_id?: string };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Fail>) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-secret');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  // 每次请求的关联ID
  const trace_id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const GH_OWNER  = (req.body?.owner as string)  || process.env.GH_OWNER;
    const GH_REPO   = (req.body?.repo as string)   || process.env.GH_REPO;
    const GH_BRANCH = (req.body?.branch as string) || process.env.GH_BRANCH || 'main';
    const GH_PAT    = process.env.GH_PAT;

    if (!GH_OWNER || !GH_REPO) return res.status(400).json({ ok: false, error: 'Missing GH_OWNER or GH_REPO', trace_id });
    if (!GH_PAT)               return res.status(400).json({ ok: false, error: 'Missing GH_PAT (server env)', trace_id });

    // 接受两套命名，统一到下划线风格
    const template     = (req.body?.template     as string) || 'form-template';
    const app_name     = (req.body?.app_name     as string) || (req.body?.appName     as string) || '';
    const api_base     = (req.body?.api_base     as string) || (req.body?.apiBase     as string) || '';
    const api_secret   = (req.body?.api_secret   as string) || (req.body?.apiSecret   as string) || '';
    const version_name = (req.body?.version_name as string) || '1.0.0';
    const version_code = (req.body?.version_code as string) || '1';
    const reason       = (req.body?.reason       as string) || 'api';

    // 关键字段严格判空 —— 空就拒绝（阻断“空值也触发工作流”）
    if (!template?.trim() || !app_name?.trim() || !api_base?.trim() || !api_secret?.trim()) {
      return res.status(400).json({ ok: false, error: 'Missing required inputs', detail: { template, app_name, api_base_len: api_base.length, api_secret_len: api_secret.length }, trace_id });
    }

    // 打印上下文：命中的部署版本和请求来源，排除“旧部署/错误入口”
    console.log(`[API][${trace_id}] raw body:`, JSON.stringify(req.body));
    console.log(`[API][${trace_id}] env:`, {
      vercel_url: process.env.VERCEL_URL,
      commit: process.env.VERCEL_GIT_COMMIT_SHA,
      host: req.headers['host'],
      referer: req.headers['referer'],
      origin: req.headers['origin'],
    });

    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`;
    const client_payload = { trace_id, template, app_name, api_base, api_secret, owner: GH_OWNER, repo: GH_REPO, branch: GH_BRANCH, version_name, version_code, reason };
    const payload = { event_type: 'generate-apk', client_payload };
    console.log(`[API][${trace_id}] payload to GitHub:`, JSON.stringify(payload));

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
      return res.status(200).json({ ok: false, error: 'GitHub dispatch failed', detail: { status: ghRes.status, body }, trace_id });
    }

    return res.status(200).json({ ok: true, note: 'repository_dispatch sent', githubStatus: ghRes.status, payloadSent: client_payload, githubBody: body, trace_id });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: err?.message || 'Internal Error', trace_id });
  }
}
