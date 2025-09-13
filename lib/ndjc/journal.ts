// lib/ndjc/journal.ts
import * as crypto from 'node:crypto';

const owner = process.env.GH_OWNER!;
const repo  = process.env.GH_REPO!;
const branch = process.env.GH_BRANCH || 'main';
const token = process.env.GH_PAT!;

function norm(p: string) {
  return p.replace(/^[/\\]+/, ''); // 去掉前导 / \，避免 404
}

async function ghPut(path: string, content: string, message: string) {
  if (!owner || !repo || !token) {
    throw new Error('Missing GH env (GH_OWNER/GH_REPO/GH_PAT)');
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(norm(path))}`;
  const body = JSON.stringify({
    message,
    content: Buffer.from(content).toString('base64'),
    branch,
  });
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GitHub PUT ${r.status} ${r.statusText}: ${url} :: ${t}`);
  }
  return r.json();
}

export function getRepoPath() {
  // 这个返回值仅用于展示；真正写盘完全走 GitHub API
  return `${owner}/${repo}`;
}

export async function writeText(runId: string, file: string, text: string) {
  const path = `requests/${runId}/${file}`;
  const msg  = `[NDJC] write ${path}`;
  return ghPut(path, text ?? '', msg);
}

export async function writeJSON(runId: string, file: string, obj: any) {
  return writeText(runId, file, JSON.stringify(obj, null, 2));
}

// 如果你还有 gitCommitPush 之类，本项目用不到也可以保留为 no-op 或继续走 GH actions
export async function gitCommitPush(_msg: string) {
  return { committed: true, sha: crypto.randomUUID() };
}
