// /pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from '@octokit/rest';
import env from '@/lib/env';

type Body = {
  prompt?: string;
  template?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  secret?: string;
};

function str(v: unknown, def = ''): string {
  if (v == null) return def;
  return String(v);
}

function required(name: string, v?: string) {
  if (!v || !v.trim()) {
    throw new Error(`${name} is required`);
  }
}

async function putFile(
  octokit: Octokit,
  p: { owner: string; repo: string; branch: string },
  path: string,
  content: string,
  message: string,
) {
  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: p.owner,
      repo: p.repo,
      path,
      ref: p.branch,
    });
    if (Array.isArray(data)) {
      // 目录，无需 sha
    } else if ('sha' in data) {
      sha = (data as any).sha;
    }
  } catch {
    // 404 -> 新文件，忽略
  }

  const base64 = Buffer.from(content, 'utf8').toString('base64');

  await octokit.repos.createOrUpdateFileContents({
    owner: p.owner,
    repo: p.repo,
    path,
    message,
    content: base64,
    branch: p.branch,
    sha,
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Only POST allowed' });
  }

  try {
    const body: Body =
      typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // 1) 校验 secret（优先 header，其次 body）
    const receivedSecret =
      str(req.headers['x-api-secret']) || str(body.secret) || '';
    const serverSecret = env.API_SECRET || env.X_API_SECRET || '';
    if (serverSecret && receivedSecret !== serverSecret) {
      return res.status(401).json({ ok: false, message: 'invalid api secret' });
    }

    // 2) 基础参数（注意 ?? 与 || 的括号顺序）
    const owner = str((body.owner ?? env.GH_OWNER) || '').trim();
    const repo = str((body.repo ?? env.GH_REPO) || '').trim();
    const branch = str((body.branch ?? env.GH_BRANCH || 'main') || 'main').trim();
    const template = str(body.template || 'form-template');
    const prompt = str(body.prompt || '');

    required('GH_OWNER', owner);
    required('GH_REPO', repo);
    required('GH_PAT', env.GH_PAT);

    // 3) Octokit
    const octokit = new Octokit({ auth: env.GH_PAT });

    // 4) 写入“内容包”，确保安卓流水线能检测到
    const packRoot = 'content_pack/app';
    const manifest = {
      template,
      updatedAt: new Date().toISOString(),
      // 这里写一些你安卓侧需要读取的 meta
    };
    const readme = `# Content Pack

Prompt:
${prompt}
`;

    await putFile(
      octokit,
      { owner, repo, branch },
      `${packRoot}/manifest.json`,
      JSON.stringify(manifest, null, 2),
      'ci(api): update content pack manifest',
    );

    await putFile(
      octokit,
      { owner, repo, branch },
      `${packRoot}/README.md`,
      readme,
      'ci(api): update content pack readme',
    );

    // 如需把 prompt 也单独存成文件，可再写一份：
    await putFile(
      octokit,
      { owner, repo, branch },
      `${packRoot}/prompt.txt`,
      prompt,
      'ci(api): update content pack prompt',
    );

    return res.status(200).json({
      ok: true,
      message: 'content pack updated',
      branch,
      owner,
      repo,
      files: [
        `${packRoot}/manifest.json`,
        `${packRoot}/README.md`,
        `${packRoot}/prompt.txt`,
      ],
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      message: err?.message || 'unexpected error',
    });
  }
}
