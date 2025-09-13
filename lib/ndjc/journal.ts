// lib/ndjc/journal.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const REMOTE_JOURNAL = process.env.NDJC_JOURNAL_REMOTE === '1';

const GH_OWNER   = process.env.GH_OWNER!;
const GH_REPO    = process.env.GH_REPO!;
const GH_BRANCH  = process.env.GH_BRANCH || 'main';
const GH_PAT     = process.env.GH_PAT!;

async function putContentToGitHub(filePath: string, content: string, message: string) {
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(filePath)}`;
  const headers = {
    'Authorization': `Bearer ${GH_PAT}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // 查询是否已存在，拿 sha
  let sha: string | undefined;
  const head = await fetch(`${api}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers });
  if (head.ok) {
    const j = await head.json().catch(() => undefined);
    sha = j?.sha;
  }

  const body = {
    message,
    branch: GH_BRANCH,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const r = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub contents PUT failed: ${r.status} ${r.statusText} :: ${txt}`);
  }
}

// 供 generate-apk 使用的“写文本/写 JSON”
export async function writeText(runId: string, rel: string, txt: string) {
  const relPath = `requests/${runId}/${rel}`;
  if (REMOTE_JOURNAL) {
    await putContentToGitHub(relPath, txt, `[NDJC] write ${relPath}`);
  } else {
    const abs = path.join(process.cwd(), relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, txt, 'utf8');
  }
}

export async function writeJSON(runId: string, rel: string, obj: any) {
  await writeText(runId, rel, JSON.stringify(obj, null, 2));
}

// 若仍保留 gitCommitPush，建议在 Vercel 环境下直接 no-op，避免误导
export async function gitCommitPush(_msg: string) {
  return { committed: REMOTE_JOURNAL, via: REMOTE_JOURNAL ? 'contents-api' : 'local-fs' };
}
