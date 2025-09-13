// lib/ndjc/journal.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const GH_API = 'https://api.github.com';

function need(k: string) {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
}

const owner  = need('GH_OWNER');
const repo   = need('GH_REPO');
const branch = process.env.GH_BRANCH || 'main';
const ghHeaders = {
  Authorization: `Bearer ${need('GH_PAT')}`,
  'X-GitHub-Api-Version': '2022-11-28',
  Accept: 'application/vnd.github+json',
};

async function ghPutFile(p: string, content: string, message: string) {
  // 如果文件已存在，先拿到 sha
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}`;
  let sha: string | undefined;
  const r0 = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders });
  if (r0.ok) {
    const j0 = await r0.json();
    if (j0 && j0.sha) sha = j0.sha;
  }

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(url, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`ghPutFile ${r.status} ${r.statusText}: ${text}`);
  }
  return r.json();
}

// 如果你还有其他地方用到它，保留一个“本地路径”的占位实现即可
export function getRepoPath() {
  return '/var/Packaging-warehouse';
}

export async function writeText(runId: string, name: string, text: string) {
  // 直接写到 GitHub：requests/<runId>/<name>
  const p = `requests/${runId}/${name}`;
  await ghPutFile(p, text, `[NDJC] write ${p}`);
}

export async function writeJSON(runId: string, name: string, obj: any) {
  await writeText(runId, name, JSON.stringify(obj, null, 2));
}

export async function gitCommitPush(_msg: string) {
  // 用 Contents API 逐文件写入后，不需要再单独 commit/push 了
  return { committed: true, via: 'gh-contents' };
}

// newRunId() 原样保留（略）……
