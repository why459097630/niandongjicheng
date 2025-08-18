// pages/api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/** -------------------- 工具函数 -------------------- **/

// GitHub Contents API 头
function ghHeaders(token: string) {
  return {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

// 读取文件 sha（有则返回 sha；404 返回 null）
async function getFileSha(opts: {
  owner: string; repo: string; path: string; ref: string; token: string;
}) {
  const { owner, repo, path, ref, token } = opts;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
  const r = await fetch(url, { headers: ghHeaders(token) });

  if (r.status === 404) return null;
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`getFileSha failed (${r.status}): ${text}`);
  }
  const json = await r.json();
  return (json && json.sha) ? String(json.sha) : null;
}

// 创建/更新单个文件
async function upsertOneFile(opts: {
  owner: string; repo: string; ref: string; token: string;
  path: string; content: string; message: string;
}) {
  const { owner, repo, ref, token, path, content, message } = opts;

  const sha = await getFileSha({ owner, repo, path, ref, token }).catch(() => null);

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: ref,
    ...(sha ? { sha } : {}),
  };

  const r = await fetch(url, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`upsertOneFile failed (${r.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

/** -------------------- Handler -------------------- **/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 仅允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 鉴权：x-api-secret 与服务端 API_SECRET 必须一致
  const incoming = (req.headers['x-api-secret'] as string) || '';
  const expected = process.env.API_SECRET || '';
  if (!expected) {
    return res.status(500).json({ error: 'API_SECRET not set on server' });
  }
  if (incoming !== expected) {
    return res.status(403).json({ error: 'Forbidden (bad secret)' });
  }

  // 环境变量（GitHub）
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const GH_OWNER = process.env.GH_OWNER || process.env.OWNER;
const GH_REPO  = process.env.GH_REPO  || process.env.REPO;
const REF      = process.env.REF || 'main';

if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
  return res.status(500).json({
    error: 'Missing GitHub envs',
    need: ['GH_TOKEN', 'GH_OWNER|OWNER', 'GH_REPO|REPO'],
  });
}

  // 解析 body；支持两种输入：
  // A) 单文件：{ filePath, content, message }
  // B) 多文件：{ files: [{ path, content }], message }
  let body: any = req.body;
  // 如果是字符串则尝试解析
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {}
  }

  const { filePath, content, message = 'chore(gen): update from API' } = body || {};
  const files: Array<{ path: string; content: string }> = Array.isArray(body?.files) ? body.files : [];

  // 输入校验
  if (!files.length && (!filePath || typeof content !== 'string')) {
    return res.status(400).json({
      error: 'Invalid payload',
      expect: [
        '{ filePath: string, content: string, message?: string }',
        'or { files: [{ path: string, content: string }], message?: string }',
      ],
    });
  }

  try {
    const tasks: Array<Promise<any>> = [];

    if (files.length) {
      for (const f of files) {
        if (!f?.path || typeof f?.content !== 'string') continue;
        tasks.push(
          upsertOneFile({
            owner, repo, ref, token,
            path: f.path,
            content: f.content,
            message,
          })
        );
      }
    } else {
      // 单文件
      tasks.push(
        upsertOneFile({
          owner, repo, ref, token,
          path: filePath,
          content,
          message,
        })
      );
    }

    const results = await Promise.all(tasks);
    return res.status(200).json({
      ok: true,
      count: results.length,
      results,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Push failed',
      detail: String(err?.message || err),
    });
  }
}

/** -------------------- 用法示例（前端） --------------------
fetch('/api/push-to-github', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-secret': '1992060419920604' // 必须与 Vercel 的 API_SECRET 一致
  },
  body: JSON.stringify({
    // 方式 A：单文件
    filePath: 'tmp/hello.txt',
    content: 'hello from browser\n',

    // 方式 B：多文件
    // files: [
    //   { path: 'app/src/main/java/xxxx/MainActivity.java', content: '...' },
    //   { path: 'app/src/main/res/layout/activity_main.xml', content: '...' },
    // ],
    message: 'chore(gen): push from web',
  })
}).then(r => r.json()).then(console.log).catch(console.error);
----------------------------------------------------------- **/
