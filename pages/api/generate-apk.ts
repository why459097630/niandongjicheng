import type { NextApiRequest, NextApiResponse } from 'next';

type FileItem = { path: string; content: string; base64?: boolean };

const OWNER = 'why459097630';
const REPO  = 'Packaging-warehouse';
const REF   = 'main';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { prompt = '', template = 'form-template' } = req.body ?? {};
  if (!prompt || !template) {
    return res.status(400).json({ ok: false, error: 'prompt & template are required' });
  }

  // 统一用服务端密钥
  const SECRET =
    process.env.API_SECRET ?? process.env.NEXT_PUBLIC_API_SECRET ?? '';
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: 'API_SECRET not set' });
  }

  // 绝对地址，避免因 Host/相对路径导致 401
  const baseUrl = `https://${process.env.VERCEL_URL ?? 'niandongjicheng.vercel.app'}`;
  const PUSH_URL = `${baseUrl}/api/push-to-github`;

  // 根据模板生成要写入的文件（示例：form-template）
  const files: FileItem[] = [
    {
      path: 'app/src/main/assets/build_marker.txt',
      content: `__FROM_API__\n${new Date().toISOString()}\nTemplate: ${template}\nPrompt: ${prompt}`,
    },
    // 👉 这里按模板补齐实际需要的文件：
    // - AndroidManifest.xml
    // - java/.../MainActivity.java
    // - res/layout/activity_main.xml
    // - res/values/strings.xml
    // - 其它模板资源……
  ];

  const message = `feat: generate from template ${template}`;

  // 由服务端去调用 push-to-github（带密钥）
  const resp = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-secret': SECRET,               // 关键：和 /api/push-to-github 校验一致
    },
    body: JSON.stringify({
      owner: OWNER,
      repo: REPO,
      ref: REF,
      message,
      files,
      base64: false,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return res.status(resp.status).json({ ok: false, error: text || resp.statusText });
  }

  const data = await resp.json();
  return res.status(200).json({ ok: true, result: data });
}
