// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Body = {
  template?: string;
  appName?: string;
  apiBase?: string;
  apiSecret?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // 校验可选的 x-api-secret（在 Vercel 环境变量里设置 NEXT_PUBLIC_X_API_SECRET）
  const headerSecret = (req.headers['x-api-secret'] as string) ?? '';
  const must = process.env.NEXT_PUBLIC_X_API_SECRET ?? '';
  if (must && headerSecret !== must) {
    return res.status(401).json({ ok: false, error: 'secret mismatch' });
  }

  // 解析 JSON body（兼容前端没设置 headers 时可能是字符串）
  let body: Body | undefined = req.body as Body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid JSON body' });
    }
  }
  body ||= {};

  const template = (body.template ?? '').trim();
  const appName  = (body.appName  ?? '').trim();
  const apiBase  = (body.apiBase  ?? '').trim();
  const apiSecret= (body.apiSecret?? '').trim();

  const miss: string[] = [];
  if (!template) miss.push('template');
  if (!appName)  miss.push('appName');
  if (!apiBase)  miss.push('apiBase');
  if (!apiSecret)miss.push('apiSecret');
  if (miss.length) {
    return res.status(400).json({ ok: false, error: `missing: ${miss.join(', ')}` });
  }

  // 触发 GitHub repository_dispatch
  const owner = process.env.GH_OWNER ?? '';            // 例如：why459097630
  const repo  = process.env.GH_REPO ?? '';             // 例如：Packaging-warehouse
  const token = process.env.GH_TOKEN ?? '';            // GitHub PAT，需 repo + workflow 权限
  if (!owner || !repo || !token) {
    return res.status(500).json({ ok: false, error: 'server env missing: GH_OWNER/GH_REPO/GH_TOKEN' });
  }

  // 你的 android-build-matrix.yml 监听的 event_type（示例为 generate-apk）
  const eventType = 'generate-apk';

  // 注意：和 workflow 中取用的 client_payload 字段名保持一致
  const payload = {
    template,
    app_name: appName,
    api_base: apiBase,
    api_secret: apiSecret,
  };

  const gh = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ndjc-server',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload,
    }),
  });

  if (!gh.ok) {
    const txt = await gh.text().catch(() => '');
    return res.status(502).json({
      ok: false,
      error: 'github_dispatch_failed',
      status: gh.status,
      detail: txt,
    });
  }

  // 派发成功：一般返回 204；这里统一给 202
  return res.status(202).json({ ok: true, message: 'dispatched', payload });
}
