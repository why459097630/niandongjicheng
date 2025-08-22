import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from 'octokit';
import { serverEnv as ENV } from '@/lib/env';

type Ok = {
  ok: true;
  owner: string;
  repo: string;
  branch: string;
  files: string[];
  commit: string;
};

type Err = {
  ok: false;
  message: string;
};

function toStringSafe(v: unknown): string {
  if (v === null || v === undefined) return '';
  // 防止对象/数组 toString 出奇怪内容，这里直接 String 即可
  return String(v);
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

async function getShaIfExists(o: Octokit, owner: string, repo: string, path: string, ref: string) {
  try {
    const res = await o.rest.repos.getContent({ owner, repo, path, ref });
    // 目录会返回数组；文件返回对象
    if (!Array.isArray(res.data) && 'sha' in res.data && typeof (res.data as any).sha === 'string') {
      return (res.data as any).sha as string;
    }
  } catch (e: any) {
    // 404 = 不存在，返回 undefined 即可
    if (e?.status !== 404) throw e;
  }
  return undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok | Err>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Only POST allowed' });
  }

  // 1) 校验密钥
  const headerSecret = toStringSafe(req.headers['x-api-secret']);
  const bodySecret = toStringSafe((req.body as any)?.secret);
  const secretOk =
    headerSecret === ENV.API_SECRET ||
    headerSecret === ENV.X_API_SECRET ||
    bodySecret === ENV.API_SECRET ||
    bodySecret === ENV.X_API_SECRET;

  if (!secretOk) {
    return res.status(401).json({ ok: false, message: 'Unauthorized: bad secret' });
  }

  // 2) 解析输入 & 兜底
  const body: any = (req.body ?? {});
  const owner = (toStringSafe(body.owner) || ENV.GH_OWNER || '').trim();
  const repo = (toStringSafe(body.repo) || ENV.GH_REPO || '').trim();
  const branch = (toStringSafe(body.branch) || ENV.GH_BRANCH || 'main').trim();

  if (!owner || !repo) {
    return res.status(400).json({ ok: false, message: 'Missing owner/repo' });
  }
  if (!ENV.GH_PAT) {
    return res.status(500).json({ ok: false, message: 'Missing GH_PAT in server env' });
  }

  // 3) 准备内容（确保 CI 识别 content_pack/app 非空）
  const prompt = toStringSafe(body.prompt);
  const template = (toStringSafe(body.template) || 'form-template').trim();
  const ts = new Date().toISOString();

  const meta = {
    template,
    prompt,
    generatedAt: ts,
    by: 'api/generate-apk'
  };

  // 你实际业务的数据，可按需扩展
  const content = {
    pages: [
      { type: 'title', text: 'Hello from API' },
      { type: 'section', text: 'This content was written by the API.' },
      { type: 'prompt', text: prompt }
    ]
  };

  // 4) 写入仓库
  try {
    const octokit = new Octokit({ auth: ENV.GH_PAT });

    const filesToWrite: Record<string, string> = {
      'content_pack/app/meta.json': JSON.stringify(meta, null, 2) + '\n',
      'content_pack/app/content.json': JSON.stringify(content, null, 2) + '\n',
      // 防止被判空，再补一个 README
      'content_pack/README.md': `# Content Pack\n\nGenerated at ${ts}\n`
    };

    const commitMsg = `chore(api): write content_pack for ${template} at ${ts}`;

    const written: string[] = [];
    for (const [path, raw] of Object.entries(filesToWrite)) {
      const sha = await getShaIfExists(octokit, owner, repo, path, branch);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: commitMsg,
        content: b64(raw),
        branch,
        sha // 如果文件已存在，必须带 sha；不存在则不带
      });
      written.push(path);
    }

    // 5) 成功返回
    return res.status(200).json({
      ok: true,
      owner,
      repo,
      branch,
      files: written,
      commit: commitMsg
    });
  } catch (e: any) {
    const msg = e?.message || 'unknown error';
    return res.status(500).json({ ok: false, message: `GitHub API error: ${msg}` });
  }
}
