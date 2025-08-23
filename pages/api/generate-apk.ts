// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Ok = {
  ok: true;
  note: string;
  githubStatus: number;
  githubBody?: any;
  echo?: Record<string, unknown>;
};
type Fail = { ok: false; error: string; detail?: any; echo?: Record<string, unknown> };

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Ok | Fail>
) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  try {
    const GH_OWNER  = (req.body?.owner  as string) || process.env.GH_OWNER;
    const GH_REPO   = (req.body?.repo   as string) || process.env.GH_REPO;
    const GH_BRANCH = (req.body?.branch as string) || process.env.GH_BRANCH || 'main';
    const GH_PAT    = process.env.GH_PAT;

    if (!GH_OWNER || !GH_REPO)
      return res.status(200).json({ ok: false, error: 'Missing GH_OWNER or GH_REPO' });
    if (!GH_PAT)
      return res.status(200).json({ ok: false, error: 'Missing GH_PAT (server env)' });

    // ---- 兼容驼峰/下划线，补齐新字段 ----
    const b = (req.body ?? {}) as Record<string, any>;

    const template      = (b.template as string) ?? 'form-template';
    const app_name      = (b.app_name ?? b.appName ?? 'MyApp') as string;

    const api_base      = (b.api_base ?? b.apiBase ?? '') as string;
    const api_secret    = (b.api_secret ?? b.apiSecret ?? '') as string;

    const version_name  = (b.version_name ?? b.versionName ?? '1.0.0') as string;
    const version_code  = (b.version_code ?? b.versionCode ?? '1') as string;
    const reason        = (b.reason as string) ?? 'api';

    // 回显（api_secret 脱敏），并打印日志方便排查“前端→接口”
    const echo = {
      template,
      owner: GH_OWNER,
      repo: GH_REPO,
      branch: GH_BRANCH,
      app_name,
      api_base,
      api_secret: api_secret ? '***masked***' : '',
      version_name,
      version_code,
      reason,
    };
    console.log('[generate-apk] payload echo:', echo);

    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`;
    const payload = {
      event_type: 'generate-apk',
      client_payload: {
        // 你已有的字段
        template,
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        app_name,
        version_name,
        version_code,
        reason,
        // 新增：给 Action 用来写入 strings.xml
        api_base,
        api_secret,
      },
    };

    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        // 你原来用的是 `token ${GH_PAT}`，GitHub 也支持；若想更标准可换成 Bearer
        Authorization: `token ${GH_PAT}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(payload),
    });

    const text = await ghRes.text();
    let body: any = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (!ghRes.ok) {
      return res
        .status(200)
        .json({ ok: false, error: 'GitHub dispatch failed', detail: { status: ghRes.status, body }, echo });
    }

    return res
      .status(200)
      .json({ ok: true, note: 'repository_dispatch sent', githubStatus: ghRes.status, githubBody: body, echo });
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: err?.message || 'Internal Error' });
  }
}
