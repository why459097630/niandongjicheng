// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type Res = NextApiResponse<{
  ok: boolean;
  message?: string;
  echo?: Record<string, unknown>;
  error?: string;
}>;

// ====== 环境变量（都在 Vercel 上配置）======
const GH_OWNER  = process.env.GH_OWNER  || '';
const GH_REPO   = process.env.GH_REPO   || '';
const GH_TOKEN  = process.env.GH_TOKEN  || process.env.GH_PAT || ''; // 任取一个可用 PAT
const HEADER_SECRET_REQUIRED =
  process.env.NEXT_PUBLIC_X_API_SECRET || process.env.X_API_SECRET || ''; // 可为空（不校验）

// 允许 OPTIONS 预检
export const config = {
  api: { bodyParser: true },
};

export default async function handler(req: NextApiRequest, res: Res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-secret');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  try {
    // 1) 可选的 header 密钥校验
    if (HEADER_SECRET_REQUIRED) {
      const got = String(req.headers['x-api-secret'] || '');
      if (got !== HEADER_SECRET_REQUIRED) {
        console.warn('[generate-apk] secret mismatch');
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }

    // 2) 解析 JSON Body，兼容驼峰/下划线两种写法
    const body = (req.body ?? {}) as Record<string, any>;
    const payload = {
      template  : body.template ?? '',
      app_name  : body.app_name ?? body.appName ?? '',
      api_base  : body.api_base ?? body.apiBase ?? '',
      api_secret: body.api_secret ?? body.apiSecret ?? '',
    };

    // 3) 打印到 Vercel 日志 + 回显给前端（密钥打星）
    console.log('[generate-apk] outgoing payload:', {
      ...payload,
      api_secret: payload.api_secret ? '***masked***' : '',
    });

    // 4) 基本校验
    const miss = Object.entries(payload)
      .filter(([k, v]) => !v)
      .map(([k]) => k);
    if (miss.length) {
      return res.status(400).json({
        ok: false,
        error: `missing fields: ${miss.join(', ')}`,
        echo: { ...payload, api_secret: payload.api_secret ? '***masked***' : '' },
      });
    }

    // 5) 发送 repository_dispatch
    if (!GH_OWNER || !GH_REPO || !GH_TOKEN) {
      console.error('[generate-apk] GH env missing', { GH_OWNER, GH_REPO, hasToken: !!GH_TOKEN });
      return res.status(500).json({ ok: false, error: 'GitHub env not configured' });
    }

    const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'generate-apk',
        client_payload: payload, // 关键：Action 里用 github.event.client_payload 拿
      }),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[generate-apk] dispatch failed', r.status, txt);
      return res.status(500).json({ ok: false, error: `dispatch failed: ${r.status}` });
    }

    return res.status(202).json({
      ok: true,
      message: 'repository_dispatch sent',
      echo: { ...payload, api_secret: '***masked***' },
    });
  } catch (e: any) {
    console.error('[generate-apk] error', e?.stack || e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
}

/* 
// 如果你采用的是 app router，请把上面的默认导出换成如下版本：
// 文件路径：app/api/generate-apk/route.ts

import { NextResponse } from 'next/server';
export const runtime = 'edge'; // 或 'nodejs'

export async function POST(req: Request) {
  // 读取 header / 解析 json / 组装 payload（与上面完全一致）
  // 调用 GitHub dispatch，同样返回 JSON。
}
*/
