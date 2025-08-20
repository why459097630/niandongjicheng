// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const VALID_TEMPLATES = ['core-template', 'form-template', 'simple-template'] as const;
type Template = (typeof VALID_TEMPLATES)[number];

function json(res: NextApiResponse, code: number, body: any) {
  res.status(code).json(body);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    // 保护：接口私钥
    const secretHeader = req.headers['x-api-secret'];
    const secretEnv = process.env.X_API_SECRET;
    if (!secretEnv || !secretHeader || secretHeader !== secretEnv) {
      return json(res, 401, { ok: false, error: 'Unauthorized: bad x-api-secret' });
    }

    // 入参校验
    const { prompt, template, dryRun } = req.body || {};
    if (typeof prompt !== 'string' || prompt.trim().length < 10) {
      return json(res, 400, { ok: false, error: 'prompt is required and must be >= 10 chars' });
    }
    if (!VALID_TEMPLATES.includes(template)) {
      return json(res, 400, {
        ok: false,
        error: `template must be one of: ${VALID_TEMPLATES.join('|')}`,
      });
    }

    // 环境变量：支持 GH_TOKEN / GITHUB_TOKEN 任一
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const ref = process.env.REF || 'main';

    const missing: string[] = [];
    if (!token) missing.push('GH_TOKEN/GITHUB_TOKEN');
    if (!owner) missing.push('GITHUB_OWNER');
    if (!repo) missing.push('GITHUB_REPO');
    if (!ref) missing.push('REF');

    if (missing.length) {
      return json(res, 500, { ok: false, error: `Missing env: ${missing.join(', ')}` });
    }

    // 生成 marker 内容 & 路径
    const now = new Date();
    const iso = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, ''); // 20250820T123456 -> 压缩
    const markerPath = `app/src/main/assets/build_marker_${iso}.txt`;
    const commitMsg = `apk: ${template} | ${now.toISOString()}`;
    const content = Buffer.from(
      [
        `prompt: ${prompt}`,
        `template: ${template}`,
        `when: ${now.toISOString()}`,
      ].join('\n'),
      'utf8',
    ).toString('base64');

    // 提供干跑：不写 GitHub，只返回 payload，方便线上/本地验证
    if (dryRun) {
      return json(res, 200, {
        ok: true,
        dryRun: true,
        repo: `${owner}/${repo}`,
        ref,
        markerPath,
        commitMsg,
      });
    }

    // 先验证 token 与 repo 是否可写，提前拿到 200/401/403
    {
      const ping = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'apk-bot' },
      });
      if (ping.status === 401 || ping.status === 403) {
        return json(res, 401, { ok: false, error: `GitHub auth failed: ${ping.status}` });
      }
      if (!ping.ok) {
        const body = await ping.text();
        return json(res, 502, { ok: false, error: `GitHub repo check ${ping.status}`, body });
      }
    }

    // 正式写入 marker
    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(markerPath)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'apk-bot',
        },
        body: JSON.stringify({
          message: commitMsg,
          content,
          branch: ref,
        }),
      },
    );

    const text = await ghRes.text();
    if (!ghRes.ok) {
      // 明确返回 GitHub 的错误给前端（403/422/…），不再 500
      return json(res, ghRes.status === 401 || ghRes.status === 403 ? 401 : 400, {
        ok: false,
        error: `GitHub PUT contents failed: ${ghRes.status}`,
        body: safeParse(text),
      });
    }

    // 成功：返回 commit 与文件链接（供你调试/溯源）
    const data = safeParse(text);
    return json(res, 200, {
      ok: true,
      ref,
      markerPath,
      commit_url: data?.commit?.html_url,
      content: data,
    });
  } catch (err: any) {
    console.error('generate-apk fatal', err);
    return json(res, 500, { ok: false, error: 'Internal Error', detail: `${err?.message || err}` });
  }
}

function safeParse(t: string) {
  try { return JSON.parse(t); } catch { return t; }
}
