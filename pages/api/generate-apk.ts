import type { NextApiRequest, NextApiResponse } from 'next';

type Ok = {
  ok: true;
  repo: string;
  ref: string;
  markerPath: string;
  commitMsg: string;
  commitUrl?: string;
  contentUrl?: string;
};
type Err = { ok: false; error: string; raw?: any };

const VALID_TEMPLATES = new Set([
  'core-template',
  'form-template',
  'simple-template',
]);

const owner  = process.env.GITHUB_OWNER!;
const repo   = process.env.GITHUB_REPO!;
const branch = process.env.GITHUB_BRANCH || 'main';
const token  = process.env.GH_TOKEN!;
const apiSecret = process.env.X_API_SECRET || process.env.API_SECRET;

function bad(res: NextApiResponse<Err>, code: number, msg: string, raw?: any) {
  return res.status(code).json({ ok: false, error: msg, raw });
}

// GitHub Contents API: create file
async function createFileViaContentsAPI(path: string, content: string, message: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    branch,
    content: Buffer.from(content, 'utf8').toString('base64'),
  };

  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'apk-generator',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Ok | Err>
) {
  res.setHeader('Cache-Control', 'no-store');

  // CORS（可按需调整域名）
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-api-secret');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return bad(res, 405, 'Method not allowed');
  }

  // 鉴权
  const pass = req.headers['x-api-secret'];
  if (!apiSecret || pass !== apiSecret) {
    return bad(res, 401, 'Unauthorized');
  }

  // 解析与校验参数
  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return bad(res, 400, 'Invalid JSON body');
  }

  const templateRaw = String(body?.template || '').trim();
  const promptRaw   = String(body?.prompt   || '').trim();
  const dryRun      = Boolean(body?.dryRun);

  const template = VALID_TEMPLATES.has(templateRaw) ? templateRaw : 'form-template';

  if (!VALID_TEMPLATES.has(template)) {
    return bad(res, 400, 'template must be one of: core-template|form-template|simple-template');
  }
  if (promptRaw.length < 10) {
    return bad(res, 400, 'prompt too short (>= 10 chars)');
  }

  // 生成 marker JSON —— 工作流将把 prompt 注入到 APK
  const marker = {
    template,
    prompt: promptRaw,
    createdAt: new Date().toISOString(),
  };

  const ts = new Date().toISOString().replace(/[:-]/g, '').replace(/\..+$/, '');
  const markerPath = `app/src/main/assets/build_marker_${ts}.json`;
  const commitMsg  = `apk: ${template} | ${ts}`;

  // dryRun：仅验证
  if (dryRun) {
    return res.status(200).json({
      ok: true,
      repo: `${owner}/${repo}`,
      ref: branch,
      markerPath,
      commitMsg,
    });
  }

  // 推送到 GitHub，触发 CI
  if (!owner || !repo || !token) {
    return bad(res, 500, 'Missing GitHub environment variables');
  }

  const { ok, status, data } = await createFileViaContentsAPI(
    markerPath,
    JSON.stringify(marker, null, 2),
    commitMsg
  );

  if (!ok) {
    return bad(res, status, 'push-to-github failed', data);
  }

  const commitUrl  = data?.commit?.html_url;
  const contentUrl = data?.content?.html_url;

  return res.status(200).json({
    ok: true,
    repo: `${owner}/${repo}`,
    ref: branch,
    markerPath,
    commitMsg,
    commitUrl,
    contentUrl,
  });
}
