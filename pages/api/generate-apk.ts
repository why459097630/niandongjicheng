// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from 'octokit';

type Ok = { ok: true; commitUrl: string; runTriggered: boolean };
type Fail = { ok: false; message: string; detail?: any };

const REQUIRED_VARS = ['GH_OWNER', 'GH_REPO', 'GH_PAT'] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Fail>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Only POST allowed' });
  }

  // （可选）简单鉴权
  const headerSecret = req.headers['x-api-secret'] ?? '';
  const must = process.env.API_SECRET ?? process.env.X_API_SECRET ?? '';
  if (must && headerSecret !== must) {
    return res.status(401).json({ ok: false, message: 'unauthorized (x-api-secret mismatch)' });
  }

  // 检查必要环境变量
  for (const k of REQUIRED_VARS) {
    if (!process.env[k]) return res.status(500).json({ ok: false, message: `missing env: ${k}` });
  }
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const token = process.env.GH_PAT!;
  const branch = process.env.GH_BRANCH || 'main';

  const { prompt = '', template = 'form-template' } = (req.body || {}) as {
    prompt?: string; template?: string;
  };
  if (!String(prompt).trim()) {
    return res.status(400).json({ ok: false, message: 'prompt required' });
  }

  const octokit = new Octokit({ auth: token });

  // 1) 写入 content pack
  const path = 'content-packs/current.json';
  const contentJson = JSON.stringify(
    {
      prompt: String(prompt).trim(),
      template,
      updatedAt: new Date().toISOString(),
      // 你需要的其它字段也可追加
    },
    null,
    2
  );
  const contentB64 = Buffer.from(contentJson, 'utf8').toString('base64');

  // 读取旧 sha（若不存在则忽略）
  let oldSha: string | undefined;
  try {
    const r = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner, repo, path, ref: branch,
    });
    // @ts-ignore
    oldSha = r.data.sha;
  } catch (_) {
    oldSha = undefined;
  }

  // 提交
  const put = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path,
    message: `feat(content-pack): update ${path}`,
    content: contentB64,
    branch,
    sha: oldSha,
    committer: { name: 'apk-bot', email: 'bot@example.com' },
    author: { name: 'apk-bot', email: 'bot@example.com' },
  });

  const commitSha = (put.data as any).commit?.sha as string;
  const commitUrl = (put.data as any).commit?.html_url as string;

  // 2) 触发 CI（两条路都发一下，任一生效即可）
  let triggered = false;
  try {
    // 2.1 repository_dispatch （需要 workflow 里监听 types: [build-apk]）
    await octokit.request('POST /repos/{owner}/{repo}/dispatches', {
      owner, repo,
      event_type: 'build-apk',
      client_payload: {
        path,
        commitSha,
        template,
      },
    });
    triggered = true;
  } catch (e) {
    // ignore，继续用 workflow_dispatch 再试一次
  }

  try {
    // 2.2 workflow_dispatch （直接点名 workflow 文件）
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
      owner, repo,
      workflow_id: '.github/workflows/android-build-matrix.yml',
      ref: branch,
      inputs: {
        template,
        commit_sha: commitSha,
      },
    });
    triggered = true;
  } catch (e) {
    // 两种都失败才算没触发
  }

  return res.status(200).json({
    ok: true,
    commitUrl,
    runTriggered: triggered,
  });
}
