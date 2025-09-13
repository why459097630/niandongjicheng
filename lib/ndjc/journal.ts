// lib/ndjc/journal.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const GH_OWNER  = process.env.GH_OWNER!;
const GH_REPO   = process.env.GH_REPO!;
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const GH_PAT    = process.env.GH_PAT!;     // 记得使用 classic token，勾选 repo + workflow

function b64(s: string) {
  return Buffer.from(s, 'utf8').toString('base64');
}

async function putGithubFile(relPath: string, content: string, message: string) {
  if (!GH_OWNER || !GH_REPO || !GH_PAT) return false;

  const base = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/`;
  const url  = base + encodeURIComponent(relPath).replace(/%2F/g, '/');
  const headers = {
    Authorization: `Bearer ${GH_PAT}`,
    Accept: 'application/vnd.github+json',
  };

  // 先查是否存在，拿到 sha
  let sha: string | undefined;
  const gr = await fetch(`${url}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers });
  if (gr.ok) {
    const j = await gr.json().catch(() => null);
    if (j && j.sha) sha = j.sha;
  }

  const body = JSON.stringify({
    message,
    content: b64(content),
    branch: GH_BRANCH,
    sha,               // 存在则传 sha，表示更新；不存在则创建
  });

  const pr = await fetch(url, { method: 'PUT', headers, body });
  if (!pr.ok) {
    const t = await pr.text();
    throw new Error(`GitHub write ${relPath} failed: ${pr.status} ${pr.statusText} :: ${t}`);
  }
  return true;
}

export function newRunId() {
  const d = new Date().toISOString().replace(/[:.]/g, '-');
  return d + '-' + Math.random().toString(16).slice(2, 6);
}

// 可选：也在 /tmp 保留一份，方便 Debug
async function writeLocalTmp(relPath: string, content: string) {
  const p = path.join('/tmp', relPath);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf8');
}

export async function writeText(runId: string, file: string, text: string) {
  const rel = `requests/${runId}/${file}`;
  await writeLocalTmp(rel, text).catch(() => {});
  await putGithubFile(rel, text, `ndjc: write ${rel}`);
}

export async function writeJSON(runId: string, file: string, data: any) {
  await writeText(runId, file, JSON.stringify(data, null, 2));
}

// 如果你还有 getRepoPath / gitCommitPush，可以保留空实现或让它们 no-op；后续不再依赖 git。
export function getRepoPath() {
  // 现在仅用来给 UI 展示，无需真实存在
  return 'Packaging-warehouse';
}
export async function gitCommitPush(_msg: string) {
  // 不再用 git；返回一个占位信息即可
  return { committed: true, via: 'github-contents-api' };
}
