// lib/ndjc/journal.ts
import * as path from 'node:path';

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const GH = {
  owner: mustEnv('GH_OWNER'),
  repo: mustEnv('GH_REPO'),
  branch: process.env.GH_BRANCH || 'main',
  token: mustEnv('GH_PAT'),
};

async function putFileToGitHub(relPath: string, content: string, message: string) {
  const api = `https://api.github.com/repos/${GH.owner}/${GH.repo}/contents/${encodeURIComponent(relPath)}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${GH.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // 若文件已存在，需要带 sha 更新
  let sha: string | undefined;
  const probe = await fetch(`${api}?ref=${encodeURIComponent(GH.branch)}`, { headers });
  if (probe.ok) {
    const j = await probe.json().catch(() => null);
    if (j?.sha) sha = j.sha;
  }

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: GH.branch,
    sha,
  };

  const r = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GitHub PUT ${relPath} -> ${r.status} ${r.statusText} :: ${text}`);
  }
}

// 生成 runId（保持你现有格式）
export function newRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-')
         + '-' + Math.random().toString(16).slice(2, 6);
}

// Vercel 上这个路径没意义，但为了兼容导出保留
export function getRepoPath() {
  return '/tmp';
}

export async function writeText(runId: string, name: string, text: string) {
  const rel = path.posix.join('requests', runId, name);
  await putFileToGitHub(rel, text, `[ndjc] ${runId} ${name}`);
}

export async function writeJSON(runId: string, name: string, obj: any) {
  await writeText(runId, name, JSON.stringify(obj, null, 2));
}

// 在 Vercel 上不再做 git push，返回个占位信息即可
export async function gitCommitPush(_msg: string) {
  return { committed: false, by: 'api' as const };
}
