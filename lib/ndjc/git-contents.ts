// lib/ndjc/git-contents.ts
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';

type PutFile = {
  path: string;         // repo 内的路径（例如 'app/src/main/AndroidManifest.xml'）
  contentB64: string;   // base64
  sha?: string | null;  // 已存在文件的 sha（更新时需要）
};

function ghHeaders() {
  const token = process.env.GH_PAT!;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  } as Record<string, string>;
}

function repoInfo() {
  const owner = process.env.GH_OWNER!;
  const repo  = process.env.GH_REPO!;
  return { owner, repo };
}

async function listDir(owner: string, repo: string, branch: string, repoPath: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return [] as any[];
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${url} :: ${await r.text()}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}

async function getFileSha(owner: string, repo: string, branch: string, repoPath: string): Promise<string | null> {
  const list = await listDir(owner, repo, branch, repoPath);
  if (!Array.isArray(list) || list.length === 0) return null;
  const node = list.find((x: any) => x.path === repoPath) || list[0];
  return node?.sha ?? null;
}

async function deleteFile(owner: string, repo: string, branch: string, repoPath: string, message: string) {
  const sha = await getFileSha(owner, repo, branch, repoPath);
  if (!sha) return; // 不存在就跳过
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(repoPath)}`;
  const body = { message, sha, branch, committer: { name: 'ndjc-bot', email: 'ndjc@example.com' } };
  const r = await fetch(url, { method: 'DELETE', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok && r.status !== 404) throw new Error(`DELETE ${repoPath} :: ${r.status} ${r.statusText} :: ${await r.text()}`);
}

async function collectFilesRecursive(owner: string, repo: string, branch: string, basePath: string) {
  const out: string[] = [];
  async function walk(p: string) {
    const nodes = await listDir(owner, repo, branch, p);
    for (const n of nodes) {
      if (n.type === 'dir') {
        await walk(n.path);
      } else if (n.type === 'file') {
        out.push(n.path);
      }
    }
  }
  // 目录不存在时 listDir 返回 []
  await walk(basePath);
  return out.sort();
}

async function putFile(owner: string, repo: string, branch: string, file: PutFile, message: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(file.path)}`;
  const body = {
    message,
    branch,
    content: file.contentB64,
    sha: file.sha || undefined,
    committer: { name: 'ndjc-bot', email: 'ndjc@example.com' },
  };
  const r = await fetch(url, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PUT ${file.path} :: ${r.status} ${r.statusText} :: ${await r.text()}`);
}

async function toBase64(p: string) {
  const buf = await fs.readFile(p);
  return Buffer.from(buf).toString('base64');
}

/**
 * 将本地 dirRoot 目录的内容上传到 repo 的 dstPath 目录（分支 branch）。
 * opts.wipeFirst = true 时，会在上传前 **递归删除** 远端 dstPath 下的所有文件，实现“镜像”效果。
 */
export async function pushDirByContentsApi(
  dirRoot: string,
  dstPath: string,
  branch: string,
  message: string,
  opts?: { wipeFirst?: boolean }
) {
  const { owner, repo } = repoInfo();

  // 1) 可选：先删除远端目录中的所有文件
  if (opts?.wipeFirst) {
    const files = await collectFilesRecursive(owner, repo, branch, dstPath);
    // 从深层到浅层删除即可（Contents API 删除文件，不需要显式删空目录）
    for (const f of files.reverse()) {
      await deleteFile(owner, repo, branch, f, `[NDJC] wipe ${dstPath} before sync`);
    }
  }

  // 2) 遍历本地目录，逐个 PUT
  async function walk(localDir: string, repoBase: string) {
    for (const ent of await fs.readdir(localDir, { withFileTypes: true })) {
      const abs = path.join(localDir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'build' || ent.name === '.gradle') continue;
        await walk(abs, path.join(repoBase, ent.name));
      } else {
        const rel = path.join(repoBase, ent.name).replace(/\\/g, '/');
        const contentB64 = await toBase64(abs);
        const sha = await getFileSha(owner, repo, branch, rel); // 存在则更新
        await putFile(owner, repo, branch, { path: rel, contentB64, sha }, message);
      }
    }
  }

  await walk(dirRoot, dstPath);
}

/** 若分支不存在则从默认分支创建同名分支（幂等） */
export async function ensureBranch(branch: string) {
  const { owner, repo } = repoInfo();
  const headers = ghHeaders();
  const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const get = await fetch(refUrl, { headers });
  if (get.ok) return;

  // 取默认分支最新 commit sha
  const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
  const repoResp = await fetch(repoUrl, { headers });
  if (!repoResp.ok) throw new Error(`${repoResp.status} ${repoResp.statusText}`);
  const repoJson: any = await repoResp.json();
  const baseRef = repoJson.default_branch || 'main';

  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseRef)}`;
  const baseResp = await fetch(baseUrl, { headers });
  if (!baseResp.ok) throw new Error(`${baseResp.status} ${baseResp.statusText}`);
  const baseJson: any = await baseResp.json();
  const sha = baseJson.object?.sha;
  if (!sha) throw new Error('cannot read base sha');

  const create = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!create.ok) throw new Error(`${create.status} ${create.statusText} :: ${await create.text()}`);
}
