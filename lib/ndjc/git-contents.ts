// lib/ndjc/git-contents.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const OWNER  = process.env.GH_OWNER!;
const REPO   = process.env.GH_REPO!;
const TOKEN  = process.env.GH_PAT!;
const API    = `https://api.github.com/repos/${OWNER}/${REPO}`;
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

// 取分支 HEAD sha
async function getRefSha(ref: string) {
  const r = await fetch(`${API}/git/ref/heads/${encodeURIComponent(ref)}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`getRefSha ${ref} :: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j?.object?.sha as string;
}

// 如果不存在则从 base(默认 main) 创建
export async function ensureBranch(branch: string, base = process.env.GH_BRANCH || 'main') {
  const create = async (sha: string) =>
    fetch(`${API}/git/refs`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });

  const baseSha = await getRefSha(base);
  const r = await create(baseSha);
  if (r.status === 422) return; // 已存在
  if (!r.ok) throw new Error(`create branch ${branch} :: ${r.status} ${await r.text()}`);
}

// 单文件 put（带 sha 则更新，不带 sha 则新建）
async function putFile(remotePath: string, content: Buffer | string, message: string, branch: string) {
  const url = `${API}/contents/${encodeURIComponent(remotePath)}`;
  // 拿 sha
  let sha: string | undefined;
  const head = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: HEADERS });
  if (head.ok) {
    const j = await head.json().catch(() => undefined);
    sha = j?.sha;
  }
  const body = {
    message,
    branch,
    content: Buffer.isBuffer(content) ? content.toString('base64')
                                      : Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(url, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PUT ${remotePath} :: ${r.status} ${await r.text()}`);
}

// 递归把一个本地目录推到仓库（忽略 build/.gradle）
export async function pushDirByContentsApi(localDir: string, remoteDir: string, branch: string, msgPrefix: string) {
  for (const e of await fs.readdir(localDir, { withFileTypes: true })) {
    const lp = path.join(localDir, e.name);
    const rp = remoteDir ? `${remoteDir}/${e.name}` : e.name;

    if (e.isDirectory()) {
      if (e.name === 'build' || e.name === '.gradle') continue;
      await pushDirByContentsApi(lp, rp, branch, msgPrefix);
    } else {
      const buf = await fs.readFile(lp);
      await putFile(rp, buf, `${msgPrefix} ${rp}`, branch);
    }
  }
}
