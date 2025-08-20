// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const VALID_TEMPLATES = ['core-template', 'form-template', 'simple-template'] as const;
type TemplateKey = typeof VALID_TEMPLATES[number];

const ensureString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // 简单鉴权
  const apiSecret = process.env.X_API_SECRET;
  if (!apiSecret) {
    return res.status(500).json({ ok: false, error: 'Server missing X_API_SECRET' });
  }
  if (req.headers['x-api-secret'] !== apiSecret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: bad x-api-secret' });
  }

  // 解析 body
  const { prompt, template } = req.body ?? {};
  if (!ensureString(prompt)) {
    return res.status(400).json({ ok: false, error: 'prompt is required (string)' });
  }
  if (!ensureString(template)) {
    return res.status(400).json({ ok: false, error: 'template is required (string)' });
  }
  if (!VALID_TEMPLATES.includes(template as TemplateKey)) {
    return res.status(400).json({
      ok: false,
      error: `template must be one of ${VALID_TEMPLATES.join(', ')}`,
    });
  }

  // ===== 构造需要提交到 push-to-github 的文件列表 =====
  // 这里先放一个 build_marker，模板文件你后面可以继续补充/拼装
  const files: Array<{ path: string; content: string }> = [
    {
      path: 'app/src/main/assets/build_marker.txt',
      content: `__FROM_GENERATE_APK__\nPrompt: ${prompt}\nTemplate: ${template}`,
    },
  ];

  // 基本校验，避免 400
  for (const f of files) {
    if (!ensureString(f.path) || !ensureString(f.content)) {
      return res.status(400).json({
        ok: false,
        error: `Bad file entry: ${JSON.stringify(f)}`,
      });
    }
  }

  // 组织 push payload
  const owner = 'why459097630';
  const repo = 'Packaging-warehouse';
  const ref = 'main';
  const message = `feat: generate from template ${template}`;

  const pushPayload = {
    owner,
    repo,
    ref,
    message,
    files,     // 注意：这里是 { path, content }，不是 filePath
    base64: false,
  };

  // 计算当前域名（生产环境直接用 vercel.app）
  const host =
    (req.headers['x-vercel-deployment-url'] as string) ||
    (process.env.VERCEL_URL as string) ||
    'niandongjicheng.vercel.app';

  const pushUrl = `https://${host}/api/push-to-github`;

  // 调用 push-to-github，并把错误透传出来
  const resp = await fetch(pushUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-secret': apiSecret,
    },
    body: JSON.stringify(pushPayload),
  });

  // 把下游的响应体原样带回，便于你用 PowerShell 看到具体错误
  const text = await resp.text();
  const contentType = resp.headers.get('content-type') || '';

  if (!resp.ok) {
    // 尝试把文本解析为 JSON；解析失败就按文本返回
    try {
      const j = JSON.parse(text);
      return res.status(resp.status).json(j);
    } catch {
      return res
        .status(resp.status)
        .setHeader('content-type', 'text/plain; charset=utf-8')
        .send(text || '(empty error body)');
    }
  }

  // 成功则把 push 的 JSON 返回
  try {
    const j = JSON.parse(text);
    return res.status(200).json(j);
  } catch {
    return res
      .status(200)
      .setHeader('content-type', contentType || 'text/plain; charset=utf-8')
      .send(text);
  }
}
