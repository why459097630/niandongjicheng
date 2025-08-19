// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Template = 'core-template' | 'form-template' | 'simple-template';

const VALID_TEMPLATES = new Set<Template>([
  'core-template',
  'form-template',
  'simple-template',
]);

/**
 * 小工具：从请求里取 header，兼容大小写
 */
function getHeader(req: NextApiRequest, name: string): string | undefined {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 组装 push-to-github 的目标地址
 * 优先用环境变量 PUSH_ENDPOINT，其次回退到当前站点的绝对地址
 */
function resolvePushEndpoint(req: NextApiRequest) {
  if (process.env.PUSH_ENDPOINT) return process.env.PUSH_ENDPOINT;
  const proto = (getHeader(req, 'x-forwarded-proto') || 'https') as string;
  const host = getHeader(req, 'host');
  return `${proto}://${host}/api/push-to-github`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // 1) 简单鉴权
  const clientSecret = getHeader(req, 'x-api-secret');
  const serverSecret = process.env.X_API_SECRET || process.env.API_SECRET; // 兼容两种命名
  if (!serverSecret || clientSecret !== serverSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // 2) 解析输入
  const { prompt, template } = (req.body ?? {}) as {
    prompt?: string;
    template?: string;
  };

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, error: 'prompt is required' });
  }

  if (typeof template !== 'string' || !VALID_TEMPLATES.has(template as Template)) {
    const allowed = Array.from(VALID_TEMPLATES.values()).join(', ');
    return res.status(400).json({
      ok: false,
      error: `template must be one of ${allowed}`,
    });
  }

  // 3) 组装需要写入到仓库的文件
  //    这里先最小可用：把本次 prompt 写到 assets/build_marker.txt，后续再扩展为写入模板文件
  const files = [
    {
      path: 'app/src/main/assets/build_marker.txt',
      content: `__FROM_API__\nTEMPLATE=${template}\nPROMPT=${prompt}`,
    },
  ];

  // 4) 准备 push-to-github 的调用
  const payload = {
    owner: process.env.GH_OWNER || 'why459097630',
    repo: process.env.GH_REPO || 'Packaging-warehouse',
    ref: process.env.GH_REF || 'main',
    message: `feat: generate from template ${template}`,
    files,
    base64: false,
  };

  const endpoint = resolvePushEndpoint(req);

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 继续把同一份密钥传给 push-to-github
        'x-api-secret': serverSecret!,
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: json?.error || `push-to-github failed: ${r.status}`,
      });
    }

    return res.status(200).json({
      ok: true,
      data: json,
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: e?.message || 'internal error',
    });
  }
}
