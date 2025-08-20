// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Json = Record<string, unknown>;

const VALID_TEMPLATES_ARR = [
  'core-template',
  'form-template',
  'simple-template',
] as const;
type TemplateName = (typeof VALID_TEMPLATES_ARR)[number];
const VALID_TEMPLATES = new Set<string>(VALID_TEMPLATES_ARR as readonly string[]);

/** 读 header，统一大小写 */
function getHeader(req: NextApiRequest, name: string): string | undefined {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** 计算同部署下的绝对 baseUrl（Vercel/本地都适用） */
function getBaseUrl(req: NextApiRequest): string {
  // 优先使用反向代理头（Vercel）
  const proto = getHeader(req, 'x-forwarded-proto') || 'https';
  const host =
    getHeader(req, 'x-forwarded-host') ||
    process.env.VERCEL_URL ||
    getHeader(req, 'host') ||
    'localhost:3000';
  return `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Json>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // 1) 解析入参
  const body = (req.body ?? {}) as Partial<{
    prompt: string;
    template: string;
    appId: string;
  }>;

  const prompt = (body.prompt ?? '').toString().trim();
  const template = (body.template ?? '').toString().trim() as TemplateName;

  if (!prompt) {
    return res.status(400).json({ ok: false, error: 'prompt is required' });
  }
  if (!VALID_TEMPLATES.has(template)) {
    return res.status(400).json({
      ok: false,
      error: `template must be one of ${VALID_TEMPLATES_ARR.join(', ')}`,
    });
  }

  // 2) 目标仓库信息（如需改，改这里）
  const owner = 'why459097630';
  const repo = 'Packaging-warehouse';
  const ref = 'main';

  // 3) 透传/回退秘钥：优先客户端 header，其次服务端环境变量
  const clientSecret = getHeader(req, 'x-api-secret');
  const serverSecret = process.env.X_API_SECRET || process.env.API_SECRET;
  const apiSecret = clientSecret ?? serverSecret ?? '';

  if (!apiSecret) {
    return res.status(401).json({
      ok: false,
      error:
        'missing x-api-secret. Please set request header "x-api-secret" or configure env var X_API_SECRET.',
    });
  }

  // 4) 组装提交内容：build_marker.txt 用来记录本次 prompt，模板在 push 接口里根据 template 参数落盘
  const marker = [
    '__FROM_GENERATE_API__',
    `time: ${new Date().toISOString()}`,
    `template: ${template}`,
    `prompt: ${prompt}`,
  ].join('\n');

  const payload = {
    owner,
    repo,
    ref,
    message: `feat: generate from template ${template}`,
    // 让 push 接口去拷贝 /templates/${template} 下的文件
    template,
    files: [
      {
        path: 'app/src/main/assets/build_marker.txt',
        content: marker,
      },
    ],
    base64: false,
  };

  // 5) 调用 push-to-github（使用绝对 URL，兼容生产）
  const baseUrl = getBaseUrl(req);
  const endpoint = `${baseUrl}/api/push-to-github`;

  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 关键：透传/回退密钥，避免 401
        'x-api-secret': apiSecret,
      },
      body: JSON.stringify(payload),
    });

    // 透传 push 接口的结果与状态码，便于前端准确提示
    const data = (await r.json().catch(() => ({}))) as Json;
    return res.status(r.status).json(data);
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      error: `generate-apk failed: ${e?.message || String(e)}`,
    });
  }
}
