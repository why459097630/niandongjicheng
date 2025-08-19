import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';

// --------- 鉴权：统一用 x-api-secret ----------
const SECRET =
  process.env.X_API_SECRET ??
  process.env.API_SECRET ??
  '';

function authFail(res: NextApiResponse, msg = 'bad x-api-secret') {
  return res.status(401).json({ ok: false, error: msg });
}

// --------- GitHub 配置 ----------
const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_OWNER = process.env.GH_OWNER || 'why459097630';
const GH_REPO  = process.env.GH_REPO  || 'Packaging-warehouse';
const GH_BRANCH= process.env.GH_BRANCH || 'main';

async function githubFetch(url: string, init?: RequestInit) {
  if (!GH_TOKEN) {
    throw new Error('GH_TOKEN is missing');
  }
  const resp = await fetch(url, {
    ...init,
    headers: {
      'authorization': `token ${GH_TOKEN}`,
      'accept': 'application/vnd.github+json',
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  return resp;
}

async function getFileSha(owner: string, repo: string, filepath: string, ref: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filepath)}?ref=${encodeURIComponent(ref)}`;
  const r = await githubFetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`getFileSha ${filepath} failed ${r.status}`);
  const j = await r.json();
  return j.sha as string;
}

async function putFile(
  owner: string,
  repo: string,
  filepath: string,
  contentBase64: string,
  message: string,
  branch: string,
) {
  const sha = await getFileSha(owner, repo, filepath, branch).catch(() => null);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filepath)}`;
  const body = {
    message,
    content: contentBase64,
    branch,
    ...(sha ? { sha } : {}),
  };
  const r = await githubFetch(url, { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`putFile ${filepath} failed ${r.status}: ${t}`);
  }
  const j = await r.json();
  return { path: filepath, sha: j.content?.sha as string | undefined };
}

// --------- 读取模板目录（递归） ----------
async function readAllFiles(root: string): Promise<Array<{ rel: string; abs: string }>> {
  const out: Array<{ rel: string; abs: string }> = [];
  async function walk(curAbs: string) {
    const entries = await fs.readdir(curAbs, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(curAbs, e.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/'); // windows 兼容
      if (e.isDirectory()) {
        await walk(abs);
      } else {
        out.push({ rel, abs });
      }
    }
  }
  await walk(root);
  return out;
}

// --------- 替换模板里需要注入的变量 ----------
function renderContent(rel: string, buf: Buffer, ctx: { prompt: string }) {
  // 仅对 build_marker.txt 注入 prompt ；其他文件保留
  if (rel.endsWith('app/src/main/assets/build_marker.txt')) {
    const stamp = new Date().toISOString();
    const text =
      `__FROM_API__\n` +
      `time: ${stamp}\n` +
      `prompt: ${ctx.prompt}\n`;
    return Buffer.from(text, 'utf8');
  }
  return buf;
}

const VALID_TEMPLATES = new Set(['core-template', 'form-template', 'simple-template']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // --- 只允许 POST ---
  if (req.method?.toUpperCase() !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // --- 统一鉴权 ---
  const got = String(req.headers['x-api-secret'] || '');
  if (!SECRET || got !== SECRET) {
    console.log('[auth-debug]', {
      hasSecretEnv: !!SECRET,
      gotLen: got.length,
      eq: SECRET ? got === SECRET : false,
    });
    return authFail(res);
  }

  // --- 解析参数 ---
  const { prompt, template } = (req.body || {}) as {
    prompt?: string;
    template?: string;
  };

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, error: 'prompt required' });
  }
  if (typeof template !== 'string' || !VALID_TEMPLATES.has(template)) {
    return res.status(400).json({ ok: false, error: `template must be one of ${[...VALID_TEMPLATES].join(', ')}` });
  }

  // --- 模板目录 ---
  const tplRoot = path.join(process.cwd(), 'templates', template);
  if (!fssync.existsSync(tplRoot)) {
    return res.status(400).json({ ok: false, error: `template folder not found: ${template}` });
  }

  // --- 读取所有文件并准备提交 ---
  let files: Array<{ rel: string; abs: string }>;
  try {
    files = await readAllFiles(tplRoot);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: `read template failed: ${e?.message || e}` });
  }

  // 改写 build_marker.txt 内容
  const rendered: Array<{ rel: string; base64: string }> = [];
  for (const f of files) {
    const buf = await fs.readFile(f.abs);
    const out = renderContent(f.rel, buf, { prompt });
    rendered.push({
      rel: f.rel, // 相对模板根的路径，即仓库中的相对路径
      base64: out.toString('base64'),
    });
  }

  // --- 逐个 PUT 到 GitHub 内容 API ---
  const message = `feat: generate from template ${template}`;
  const written: Array<{ path: string; sha?: string }> = [];
  try {
    for (const f of rendered) {
      const p = f.rel; // 保持模板目录结构即仓库中的路径
      const r = await putFile(GH_OWNER, GH_REPO, p, f.base64, message, GH_BRANCH);
      written.push(r);
    }
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: `github write failed: ${e?.message || e}`, written });
  }

  // --- 返回结果：包含写入了哪些文件（便于你在 CI 日志中校验） ---
  return res.status(200).json({
    ok: true,
    owner: GH_OWNER,
    repo: GH_REPO,
    branch: GH_BRANCH,
    template,
    files: written,
    tips: 'APK 内 assets/build_marker.txt 会包含本次 prompt，可用来验证是否“空包”',
  });
}
