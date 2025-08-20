// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export const config = { api: { bodyParser: true } };

const VALID_TEMPLATES = new Set(['core-template', 'form-template', 'simple-template']);

function fail(res: NextApiResponse, status: number, error: string, extra: any = {}) {
  return res.status(status).json({ ok: false, error, ...extra });
}

async function readAnyBody(req: NextApiRequest) {
  // 兼容：已解析 JSON / 原始字节 / JSON 字符串
  let body: any = (req as any).body;
  const emptyObj = body && typeof body === 'object' && Object.keys(body).length === 0;

  if (!body || typeof body === 'string' || emptyObj) {
    const chunks: Buffer[] = [];
    for await (const c of (req as any)) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const raw = Buffer.concat(chunks).toString('utf8');
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return body;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return fail(res, 405, 'method not allowed');

    // 简单鉴权
    const secret = req.headers['x-api-secret'];
    if (!secret || String(secret) !== process.env.X_API_SECRET) {
      return fail(res, 401, 'unauthorized');
    }

    // 解析 body
    const body = await readAnyBody(req);
    if (!body || typeof body !== 'object') {
      return fail(res, 400, 'body must be JSON with { prompt, template }');
    }

    const { prompt, template } = body as { prompt?: string; template?: string };

    if (typeof prompt !== 'string' || prompt.trim().length < 20) {
      return fail(res, 400, 'prompt is required and should be a descriptive sentence (>= 20 chars)');
    }
    if (typeof template !== 'string' || !VALID_TEMPLATES.has(template)) {
      return fail(res, 400, `template must be one of ${Array.from(VALID_TEMPLATES).join(', ')}`);
    }

    // 构造 push-to-github 的提交内容 —— 生成一个带时间戳的 marker 文件
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14); // yyyymmddHHMMSS
    const markerPath = `app/src/main/assets/build_marker_${stamp}.txt`;
    const commitMessage = `feat: generate from template ${template}`;
    const markerContent = `__FROM_API__ ${template} ${now.toISOString()}`;

    const pushPayload = {
      owner: 'why459097630',
      repo: 'Packaging-warehouse',
      ref: 'main',
      message: commitMessage,
      files: [{ path: markerPath, content: markerContent }],
      base64: false,
      // 如你的 /api/push-to-github 也要用到 template，可一并传过去
      template,
    };

    // 计算当前服务的根地址来调用内部 API
    const baseURL = `https://${req.headers.host}`;
    const pushResp = await fetch(`${baseURL}/api/push-to-github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-secret': process.env.X_API_SECRET || '',
      },
      body: JSON.stringify(pushPayload),
    });

    const raw = await pushResp.text();
    let json: any;
    try { json = JSON.parse(raw); } catch {
      return fail(res, 500, 'push-to-github returned non-json', { raw });
    }

    if (!pushResp.ok || json?.ok === false) {
      return fail(res, 400, 'push-to-github failed', { status: pushResp.status, resp: json });
    }

    // 成功。把 marker 路径、commit 信息等返回给前端
    return res.status(200).json({
      ok: true,
      template,
      prompt: prompt.trim(),
      markerPath,
      push: json,
    });
  } catch (e: any) {
    console.error('[generate-apk] unhandled error', e);
    return fail(res, 500, e?.message || 'internal error');
  }
}
