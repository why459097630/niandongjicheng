// /api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const GH_API = 'https://api.github.com';

async function upsertFile(params: {
  owner: string;
  repo: string;
  path: string;
  content: string | Buffer;
  message: string;
  token: string;
}) {
  const { owner, repo, path, content, message, token } = params;

  // get sha if file exists
  let sha: string | undefined;
  const getResp = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'niandongjicheng' }
  });
  if (getResp.ok) {
    const j = await getResp.json();
    if (j && j.sha) sha = j.sha;
  }

  const b64 = Buffer.from(typeof content === 'string' ? content : content).toString('base64');

  const putResp = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'niandongjicheng',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      content: b64,
      sha
    })
  });

  if (!putResp.ok) {
    const text = await putResp.text();
    throw new Error(`Failed to write ${path}: ${putResp.status} ${text}`);
  }
}

function pkgToPath(packageName: string) {
  // com.example.meditationtimer -> com/example/meditationtimer
  return packageName.trim().replace(/\s+/g, '').split('.').join('/');
}

type Payload = {
  packageName: string;
  java?: Record<string, string>;
  resLayout?: Record<string, string>;
  resValues?: Record<string, string>;
  manifestPatch?: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

    const token = process.env.GITHUB_TOKEN as string;
    const owner = (process.env.GITHUB_OWNER as string) || 'why459097630';
    const repo = (process.env.GITHUB_REPO as string) || 'Packaging-warehouse';

    if (!token) return res.status(500).json({ ok: false, error: 'Missing GITHUB_TOKEN' });

    const body: Payload = req.body || {};
    const pkg = body.packageName?.trim();
    if (!pkg) return res.status(400).json({ ok: false, error: 'packageName is required' });

    // 基础必需文件校验（少了就不允许进入打包）
    const hasMain = !!body.java && !!body.java['MainActivity.java'];
    const hasLayout = !!body.resLayout && !!body.resLayout['activity_main.xml'];
    const hasStrings = !!body.resValues && !!body.resValues['strings.xml'];
    if (!hasMain || !hasLayout || !hasStrings) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required files: MainActivity.java / activity_main.xml / strings.xml'
      });
    }

    const javaDir = `app/src/main/java/${pkgToPath(pkg)}`;
    const layoutDir = `app/src/main/res/layout`;
    const valuesDir = `app/src/main/res/values`;

    // 1) 写 Java
    for (const [name, code] of Object.entries(body.java || {})) {
      await upsertFile({
        owner, repo,
        path: `${javaDir}/${name}`,
        content: code,
        message: `chore(gen): update ${name}`,
        token
      });
    }

    // 2) 写 layout
    for (const [name, code] of Object.entries(body.resLayout || {})) {
      await upsertFile({
        owner, repo,
        path: `${layoutDir}/${name}`,
        content: code,
        message: `chore(gen): update layout ${name}`,
        token
      });
    }

    // 3) 写 values
    for (const [name, code] of Object.entries(body.resValues || {})) {
      await upsertFile({
        owner, repo,
        path: `${valuesDir}/${name}`,
        content: code,
        message: `chore(gen): update values ${name}`,
        token
      });
    }

    // 4) 如需对 Manifest 打补丁（可选）：这里采用“覆盖文件”的简化版
    if (body.manifestPatch) {
      await upsertFile({
        owner, repo,
        path: `app/src/main/AndroidManifest.xml`,
        content: body.manifestPatch,
        message: `chore(gen): patch AndroidManifest.xml`,
        token
      });
    }

    // 5) 生成标记：用于 CI 校验“确实写入过生成内容”
    await upsertFile({
      owner, repo,
      path: `generated/.ok`,
      content: `package=${pkg}\n${new Date().toISOString()}\n`,
      message: `chore(gen): mark generated ok`,
      token
    });

    return res.json({ ok: true, repo, packageName: pkg });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
