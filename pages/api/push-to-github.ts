// /pages/api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: true } };

function env(name: string) {
  return process.env[name];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    // 兼容两套命名
    const token = env('GITHUB_TOKEN') || env('GH_TOKEN');
    const owner = (env('GITHUB_REPO')?.split('/')[0]) || env('OWNER')!;
    const repo = (env('GITHUB_REPO')?.split('/')[1]) || env('REPO')!;
    const workflowFile = env('GITHUB_WORKFLOW_FILE') || env('WORKFLOW') || 'android-build-matrix.yml';
    const ref = env('REF') || 'main';

    if (!token || !owner || !repo) {
      return res.status(500).json({ ok: false, error: 'ENV_MISSING' });
    }

    // 1) 取目标仓库当前分支的 HEAD SHA（供后续 run-by-sha 查 run）
    const headResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!headResp.ok) {
      const text = await headResp.text();
      return res.status(500).json({ ok: false, error: 'HEAD_LOOKUP_FAILED', status: headResp.status, detail: text.slice(0, 400) });
    }
    const head = await headResp.json();
    const headSha = head?.sha as string;

    // 2) 触发 workflow_dispatch
    const body = req.body ?? {};
    const inputs = {
      app_name: body.appName || 'Generated App',
      package_name: body.packageName || 'com.example.generated',
      commit_sha: headSha,                                 // 关键：返回给前端用于 run-by-sha
      template_slug: body.template || body.template_slug || 'simple-template',
    };

    const dispatch = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref, inputs }),
    });

    if (dispatch.status !== 204) {
      const text = await dispatch.text();
      return res.status(500).json({ ok: false, error: 'DISPATCH_FAILED', status: dispatch.status, detail: text.slice(0, 400) });
    }

    // 返回 commitSha 给前端，后续 /run-by-sha 将用它找到本次 run
    return res.status(200).json({ ok: true, commitSha: headSha });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'UNKNOWN' });
  }
}
