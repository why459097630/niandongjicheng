// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

type FileItem = {
  path: string;          // 目标仓库中的相对路径
  content: string;       // 文本或 base64 内容
  base64?: boolean;      // 若为二进制，置为 true
};

type PushPayload = {
  owner: string;
  repo: string;
  ref: string;
  message: string;
  files: FileItem[];
};

const VALID_TEMPLATES = ['core-template', 'form-template', 'simple-template'] as const;
type TemplateName = typeof VALID_TEMPLATES[number];

export const config = {
  api: {
    bodyParser: true,
    sizeLimit: '20mb',
  },
};

/** 允许作为二进制处理的扩展名 */
const BINARY_EXTS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.ico', '.jar', '.keystore', '.webm', '.mp3', '.mp4', '.wav',
  // 你可以按需补充
];

/** 是否二进制文件 */
function isBinaryExt(file: string) {
  const ext = path.extname(file).toLowerCase();
  return BINARY_EXTS.includes(ext);
}

/** 递归读取模板目录，构造 push-to-github 所需 files 列表 */
function readTemplateFiles(templateRoot: string, repoRootPrefix = ''): FileItem[] {
  const out: FileItem[] = [];

  function walk(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(currentDir, ent.name);
      const rel = path.relative(templateRoot, abs).split(path.sep).join('/'); // POSIX 化
      const repoPath = repoRootPrefix
        ? `${repoRootPrefix.replace(/\/+$/, '')}/${rel}`
        : rel;

      if (ent.isDirectory()) {
        walk(abs);
      } else {
        if (isBinaryExt(abs)) {
          const buf = fs.readFileSync(abs);
          out.push({
            path: repoPath,
            content: buf.toString('base64'),
            base64: true,
          });
        } else {
          const text = fs.readFileSync(abs, 'utf8');
          out.push({
            path: repoPath,
            content: text,
          });
        }
      }
    }
  }

  walk(templateRoot);
  return out;
}

/** 获取本服务的 base URL（用于内部调用 /api/push-to-github） */
function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers['x-forwarded-proto'] as string) ||
    (req.headers['x-forwarded-protocol'] as string) ||
    'https';
  const host =
    (req.headers['x-forwarded-host'] as string) ||
    (req.headers['host'] as string);
  return `${proto}://${host}`;
}

/** 读取 header 值（兼容数组情况） */
function readHeader(req: NextApiRequest, key: string) {
  const v = req.headers[key.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v as string | undefined;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // --- Auth ---
  const headerSecret = readHeader(req, 'x-api-secret') || '';
  const envSecret = process.env.X_API_SECRET || '';
  if (!headerSecret) {
    return res
      .status(401)
      .json({ ok: false, error: 'Unauthorized: x-api-secret header missing' });
  }
  if (headerSecret !== envSecret) {
    return res
      .status(401)
      .json({ ok: false, error: 'Unauthorized: bad x-api-secret' });
  }

  // --- Parse Body ---
  const body: any = req.body && typeof req.body === 'string'
    ? safeParse(req.body)
    : req.body;

  const prompt = body?.prompt;
  const template = body?.template as TemplateName;

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, error: 'param "prompt" is required' });
  }
  if (typeof template !== 'string' || !VALID_TEMPLATES.includes(template as any)) {
    return res.status(400).json({
      ok: false,
      error: `param "template" is invalid; must be one of ${VALID_TEMPLATES.join(', ')}`,
    });
  }

  try {
    // 1) 读取模板文件
    const templateDir = path.join(process.cwd(), 'templates', template);
    if (!fs.existsSync(templateDir)) {
      return res.status(400).json({ ok: false, error: `template dir not found: ${template}` });
    }

    // 将模板内容提交到仓库根目录（通常模板内已经以 app/** 组织）
    const files = readTemplateFiles(templateDir);

    // 2) 额外写入 build_marker.txt 以便在 APK 中确认来源
    const marker = [
      `prompt: ${prompt}`,
      `template: ${template}`,
      `ts: ${new Date().toISOString()}`,
    ].join('\n');

    files.push({
      path: 'app/src/main/assets/build_marker.txt',
      content: marker,
    });

    // 3) 拼装 push-to-github 请求
    const payload: PushPayload = {
      owner: 'why459097630',               // ← 如需改仓库，这里改
      repo: 'Packaging-warehouse',         // ← 如需改仓库，这里改
      ref: 'main',
      message: `feat: generate from template ${template}`,
      files,
    };

    const base = getBaseUrl(req);
    const resp = await fetch(`${base}/api/push-to-github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-secret': headerSecret, // 继续带上同一个 secret
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        error: 'push-to-github failed',
        detail: data,
      });
    }

    // 成功
    return res.status(200).json({
      ok: true,
      template,
      prompt,
      push: data,
    });
  } catch (err: any) {
    console.error('[generate-apk] error:', err);
    return res.status(500).json({
      ok: false,
      error: 'internal error',
      detail: err?.message ?? String(err),
    });
  }
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}
