// app/api/generate-apk/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // 确保用 Node 运行时

type In = {
  template?: string;
  appName?: string;
  apiBase?: string;
  apiSecret?: string;
};

export async function POST(req: Request) {
  try {
    // 可选 header 校验
    const headerSecret = req.headers.get('x-api-secret') ?? '';
    const must = process.env.NEXT_PUBLIC_X_API_SECRET ?? '';
    if (must && headerSecret !== must) {
      return NextResponse.json({ ok: false, error: 'secret mismatch' }, { status: 401 });
    }

    // 解析 JSON
    let body: In;
    try {
      body = (await req.json()) as In;
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
    }

    const template = (body.template ?? '').trim();
    const appName  = (body.appName  ?? '').trim();
    const apiBase  = (body.apiBase  ?? '').trim();
    const apiSecret= (body.apiSecret?? '').trim();

    // 必填校验
    const miss: string[] = [];
    if (!template) miss.push('template');
    if (!appName)  miss.push('appName');
    if (!apiBase)  miss.push('apiBase');
    if (!apiSecret)miss.push('apiSecret');
    if (miss.length) {
      console.warn('Bad Request, missing:', miss);
      return NextResponse.json({ ok: false, error: `missing: ${miss.join(', ')}` }, { status: 400 });
    }

    console.log('Generate APK payload:', { template, appName, apiBase, apiSecretLen: apiSecret.length });

    // 触发 GitHub repository_dispatch
    const token = process.env.GH_PAT ?? process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json({ ok: false, error: 'GITHUB token missing' }, { status: 500 });
    }

    const repo = process.env.GH_REPO ?? 'why459097630/Packaging-warehouse';
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'generate-apk',
        client_payload: {
          template,
          app_name: appName,
          api_base: apiBase,
          api_secret: apiSecret,
        },
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error('GitHub dispatch failed', r.status, text);
      return NextResponse.json({ ok: false, error: 'github dispatch failed', detail: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true, sent: { template, appName, apiBase } });
  } catch (e: any) {
    console.error('API error:', e);
    return NextResponse.json({ ok: false, error: 'internal error' }, { status: 500 });
  }
}

// 如果有人 GET 访问，直接 405
export async function GET() {
  return NextResponse.json({ ok: false, error: 'Method Not Allowed' }, { status: 405 });
}
