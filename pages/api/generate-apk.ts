// /pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';

const VALID_TEMPLATES = new Set(['core-template', 'form-template', 'simple-template']);

const GH_OWNER  = process.env.GH_OWNER  || 'why459097630';
const GH_REPO   = process.env.GH_REPO   || 'Packaging-warehouse';
const GH_BRANCH = process.env.GH_BRANCH || 'main';

function getBaseUrl(req: NextApiRequest) {
  const envUrl = process.env.SITE_URL || process.env.VERCEL_URL; // 例如 niandongjicheng.vercel.app（不要 http）
  if (envUrl) return `https://${envUrl}`;
  const host  = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  // 统一鉴权
  if (req.headers['x-api-secret'] !== process.env.X_API_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const { prompt, template } = (req.body || {}) as { prompt?: string; template?: string };

    if (!template || typeof template !== 'string' || !VALID_TEMPLATES.has(template)) {
      return res.status(400).json({
        ok: false,
        error: `"template" 必须是 ${Array.from(VALID_TEMPLATES).join(', ')} 之一`
      });
    }

    // 读取模板文件（存在才复制）
    const tplRoot = path.join(process.cwd(), 'templates', template);
    const candidateFiles = [
      'app/build.gradle',
      'app/src/main/AndroidManifest.xml',
      'app/src/main/java/com/example/app/MainActivity.java',
      'app/src/main/res/layout/activity_main.xml',
      'app/src/main/res/values/strings.xml',
    ];

    const filesFromTemplate = candidateFiles
      .filter(rel => fs.existsSync(path.join(tplRoot, rel)))
      .map(rel => ({
        path: rel,
        content: fs.readFileSync(path.join(tplRoot, rel), 'utf8'),
      }));

    if (filesFromTemplate.length === 0) {
      return res.status(400).json({
        ok: false,
        error: `模板 "${template}" 下未找到可用文件，请检查 /templates/${template} 是否包含至少一个文件`
      });
    }

    // 写一个标记文件，方便排查
    const files = [
      ...filesFromTemplate,
      {
        path: 'app/src/main/assets/build_marker.txt',
        content: [
          `prompt: ${prompt ?? ''}`,
          `template: ${template}`,
          `time: ${new Date().toISOString()}`
        ].join('\n'),
      },
    ];

    // 统一 payload（注意用 path + content）
    const payload = {
      owner: GH_OWNER,
      repo: GH_REPO,
      ref: GH_BRANCH,
      message: `feat: generate from template ${template}`,
      files, // [{ path, content, base64? }]
    };

    const r = await fetch(`${getBaseUrl(req)}/api/push-to-github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-secret': String(process.env.X_API_SECRET), // 透传秘钥
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => null);
    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: data?.error || 'push-to-github failed',
      });
    }

    return res.status(200).json({ ok: true, template, ...data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'unexpected server error' });
  }
}
