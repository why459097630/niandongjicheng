// pages/api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Payload = {
  filePath: string;          // 例: 'app/src/main/java/.../MainActivity.java'
  content: string;           // 文件内容（UTF-8 文本；或已是 base64）
  message?: string;          // Commit message
  ref?: string;              // 目标分支，默认 main
  base64?: boolean;          // 如果为 true，content 视为已 base64 编码
};

const json = (res: NextApiResponse, status: number, body: any) =>
  res.status(status).json(body);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  // CORS（可选）
  try {
    const allowOrigin = process.env.ALLOW_ORIGIN || '*';
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-secret');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  } catch { /* 忽略 */ }

  // 校验 API_SECRET
  const apiSecret = process.env.API_SECRET;
  const clientSecret = (req.headers['x-api-secret'] || '') as string;
  if (!apiSecret || clientSecret !== apiSecret) {
    return json(res, 403, { ok: false, error: 'Forbidden' });
  }

  // 读取 GitHub 相关 env（兼容两套命名）
  const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const GH_OWNER = process.env.GH_OWNER || process.env.OWNER;
  const GH_REPO = process.env.GH_REPO || process.env.REPO;
  const REF = process.env.REF || 'main';

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    return json(res, 500, {
      ok: false,
      error: 'Missing GitHub envs',
      need: ['GH_TOKEN', 'GH_OWNER|OWNER', 'GH_REPO|REPO'],
    });
  }

  // 解析 body
  let payload: Payload;
  try {
    payload = req.body as Payload;
    if (typeof payload === 'string') payload = JSON.parse(payload);
  } catch (e: any) {
    return json(res, 400, { ok: false, error: 'Invalid JSON body', detail: e?.message });
  }

  const filePath = (payload.filePath || '').trim();
  const message =
    payload.message?.trim() ||
    `chore(gen): update ${filePath} by api ${new Date().toISOString()}`;
  const ref = (payload.ref || REF).trim();
  const isBase64 = !!payload.base64;

  if (!filePath) {
    return json(res, 400, { ok: false, error: 'filePath is required' });
  }
  if (typeof payload.content !== 'string') {
    return json(res, 400, { ok: false, error: 'content must be string' });
  }

  // Base64 编码
  const contentB64 = isBase64
    ? payload.content
    : Buffer.from(payload.content, 'utf8').toString('base64');

  // GitHub API 基本参数
  const ghHeaders = {
    Authorization: `token ${GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // 1) 先尝试获取当前文件获取 sha（决定是更新还是创建）
  let sha: string | undefined;
  try {
    const getUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(
      filePath
    )}?ref=${encodeURIComponent(ref)}`;

    const r = await fetch(getUrl, { headers: ghHeaders, method: 'GET' });
    if (r.status === 200) {
      const data = await r.json();
      sha = data?.sha;
    } else if (r.status !== 404) {
      // 404 表示文件不存在可忽略；其他状态报错
      const text = await r.text();
      return json(res, 502, {
        ok: false,
        error: 'Failed to read file from GitHub',
        status: r.status,
        body: safeJson(text),
      });
    }
  } catch (e: any) {
    return json(res, 502, { ok: false, error: 'GitHub read error', detail: e?.message });
  }

  // 2) PUT 写入内容
  try {
    const putUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(
      filePath
    )}`;

    const body = {
      message,
      content: contentB64,
      branch: ref,
      ...(sha ? { sha } : {}),
    };

    const r = await fetch(putUrl, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(body),
    });

    const text = await r.text();
    if (r.status >= 200 && r.status < 300) {
      return json(res, 200, { ok: true, status: r.status, data: safeJson(text) });
    }
    return json(res, 502, {
      ok: false,
      error: 'GitHub write failed',
      status: r.status,
      body: safeJson(text),
    });
  } catch (e: any) {
    return json(res, 502, { ok: false, error: 'GitHub write error', detail: e?.message });
  }
}

/** 尝试把字符串解析成 JSON；失败则原样返回 */
function safeJson(input: any) {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
