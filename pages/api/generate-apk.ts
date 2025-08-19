// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type GhFile = { path: string; sha?: string };
type Ok = { ok: true; appId: string; template: string; files: GhFile[] };
type Fail = { ok: false; error: string; detail?: any };
type Result = Ok | Fail;

// ———————————————————————————————————————————————————————————
// 小工具
// ———————————————————————————————————————————————————————————

function xmlText(s: string) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/%/g, '%%');
}

const ALLOWED_TEMPLATES = ['core-template', 'form-template', 'simple-template'] as const;

// 二进制文件（必须原样 base64 透传）
const BINARY_EXT = /\.(jar|png|jpg|jpeg|webp|gif|ico|keystore|jks|aab|apk|aar|so|ttf|otf|mp3|wav|ogg|mp4|webm|pdf|zip|gz|bz2|7z|rar|bin|dex|arsc)$/i;

// ———————————————————————————————————————————————————————————
// 入口
// ———————————————————————————————————————————————————————————

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  // CORS
  const allow = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Auth
  const secret = (process.env.API_SECRET || '').trim();
  const incoming = String(req.headers['x-api-secret'] || (req.body as any)?.apiSecret || '').trim();
  if (!secret || incoming !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: bad x-api-secret' });
  }

  // ENV
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER || process.env.OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO || process.env.REPO;
  const BRANCH = process.env.REF || 'main';
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({ ok: false, error: 'Missing env: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO' });
  }

  // Body
  const { prompt = '', template } = (req.body || {}) as { prompt?: string; template?: string };
  if (!template || !(ALLOWED_TEMPLATES as readonly string[]).includes(template)) {
    return res.status(400).json({ ok: false, error: `Bad template: ${template}` });
  }

  // appId / pkgPath
  const slug = (prompt || 'myapp').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^\d+/, '') || 'myapp';
  const appId = `com.example.${slug}`;
  const pkgPath = appId.replace(/\./g, '/');
  const appName = (prompt || 'MyApp').slice(0, 30);
  const ts = new Date().toISOString();
  const marker = `__PROMPT__${prompt || 'EMPTY'}__ @ ${ts}`;

  // GitHub helpers
  const base = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}`;

  const ghFetch = (url: string, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'tpl-copier',
        ...(init?.headers || {}),
      } as any,
    });

  async function ghGet(path: string, ref = BRANCH): Promise<any | null> {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}?ref=${ref}`);
    if (r.status === 200) return r.json();
    return null;
  }

  async function ghList(path: string, ref = BRANCH): Promise<any[] | null> {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}?ref=${ref}`);
    if (r.status === 200) {
      const j = await r.json();
      return Array.isArray(j) ? j : null;
    }
    return null;
  }

  // 低层 upsert：content 必须是 base64
  async function upsertRawBase64(path: string, base64: string, message: string): Promise<GhFile> {
    let sha: string | undefined;
    const got = await ghGet(path);
    if (got?.sha) sha = got.sha;

    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        branch: BRANCH,
        content: base64,
        ...(sha ? { sha } : {}),
      }),
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Write ${path} failed: ${r.status} ${await r.text()}`);
    }
    const data = (await r.json()) as any;
    return { path, sha: data?.content?.sha };
  }

  // 文本（可替换），默认 [skip ci]
  async function upsertText(path: string, text: string, message: string, skipCi = true): Promise<GhFile> {
    const msg = skipCi ? `${message} [skip ci]` : message;
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    return upsertRawBase64(path, b64, msg);
  }

  // 二进制（base64 原样透传），默认 [skip ci]
  async function upsertBinary(path: string, base64: string, message: string, skipCi = true): Promise<GhFile> {
    const msg = skipCi ? `${message} [skip ci]` : message;
    return upsertRawBase64(path, base64, msg);
  }

  // 删除（带 [skip ci]）
  async function ghDelete(path: string, sha: string, message = 'chore: remove old MainActivity.java', skipCi = true) {
    const msg = skipCi ? `${message} [skip ci]` : message;
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: msg, sha, branch: BRANCH }),
    });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Delete ${path} failed: ${r.status} ${await r.text()}`);
    }
  }

  // 删除历史 MainActivity，避免重复
  async function cleanOldJava(targetPkgPath: string) {
    const root = 'app/src/main/java/com/example';
    const list = await ghList(root);
    if (!list) return;

    const desired = `${targetPkgPath}/MainActivity.java`.replace(/^app\/src\/main\/java\//, '');
    for (const d of list) {
      if (d.type !== 'dir') continue;
      const filePath = `${root}/${d.name}/MainActivity.java`;
      const got = await ghGet(filePath);
      if (got?.sha) {
        const rel = filePath.replace(/^app\/src\/main\/java\//, '');
        if (rel !== desired) {
          await ghDelete(filePath, got.sha);
        }
      }
    }
  }

  // 遍历模板目录
  async function walk(dirPath: string, acc: any[] = []) {
    const list = await ghList(dirPath);
    if (!list) return acc;
    for (const it of list) {
      if (it.type === 'dir') await walk(it.path, acc);
      else if (it.type === 'file') acc.push(it);
    }
    return acc;
  }

  // 将模板路径改写为目标路径（修正 Java 包路径）
  function rewriteTargetPath(srcTplPath: string): string {
    const rel = srcTplPath.replace(/^templates\/[^/]+\//, '');
    const m = rel.match(/^app\/src\/main\/java\/(.+?)\/([^/]+)\.(java|kt)$/);
    if (m) {
      const fileName = `${m[2]}.${m[3]}`;
      return `app/src/main/java/${pkgPath}/${fileName}`;
    }
    return rel;
  }

  // 文本内容替换（包名、app 名称、strings、namespace 等）
  function transformContent(raw: string, srcPath: string) {
    let s = raw;

    const replacements: Record<string, string> = {
      '{{APP_ID}}': appId,
      '__APP_ID__': appId,
      '$APP_ID$': appId,
      '@@APP_ID@@': appId,

      '{{APP_NAME}}': appName,
      '__APP_NAME__': appName,
      '$APP_NAME$': appName,
      '@@APP_NAME@@': appName,

      '{{PROMPT}}': prompt,
      '__PROMPT__': prompt,
      '$PROMPT$': prompt,
      '@@PROMPT@@': prompt,
    };
    for (const [k, v] of Object.entries(replacements)) s = s.split(k).join(v);

    if (srcPath.endsWith('build.gradle')) {
      s = s.replace(/namespace\s+"[^"]+"/, `namespace "${appId}"`);
    }
    if (srcPath.endsWith('AndroidManifest.xml')) {
      s = s.replace(/package="[^"]+"/, `package="${appId}"`);
    }
    if (/\.(java|kt)$/.test(srcPath)) {
      s = s.replace(/^package\s+[\w.]+;/m, `package ${appId};`);
      s = s.replace(/com\.example\.[\w.]+/g, appId);
    }
    if (srcPath.endsWith('strings.xml')) {
      s = s.replace(/(<string name="app_name">)(.*?)(<\/string>)/, `$1${xmlText(appName)}$3`);
    }
    return s;
  }

  try {
    // 1) 清理旧包名下 MainActivity
    await cleanOldJava(`app/src/main/java/${pkgPath}`);

    // 2) 遍历模板
    const tplRoot = `templates/${template}`;
    const items = await walk(tplRoot);

    const written: GhFile[] = [];

    // 3) 写入每个文件（全部 [skip ci]）
    for (const it of items) {
      const meta = await ghGet(it.path);
      if (!meta?.content) continue;

      const targetPath = rewriteTargetPath(it.path);
      const msg = `feat: generate from template ${template}`;

      if (BINARY_EXT.test(it.path)) {
        // 二进制：原样 base64 透传
        written.push(await upsertBinary(targetPath, meta.content as string, msg, true));
      } else {
        // 文本：做占位符 + 包名替换
        const raw = Buffer.from(meta.content as string, 'base64').toString('utf8');
        const replaced = transformContent(raw, it.path);
        written.push(await upsertText(targetPath, replaced, msg, true));
      }
    }

    // 4) 附加信息（[skip ci]）
    written.push(await upsertText('app/src/main/assets/build_marker.txt', marker, 'chore: marker', true));

    // 5) 仅最后一次不带 [skip ci]：触发 CI
    written.push(
      await upsertText(
        'app/ci_nudge.txt',
        `${ts}\n${appId}\n${template}\n`,
        `build: generate from template ${template}`,
        /* skipCi */ false
      )
    );

    return res.status(200).json({ ok: true, appId, template, files: written });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'Generate failed', detail: String(e?.message || e) });
  }
}
