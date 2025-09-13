// lib/ndjc/journal.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const REMOTE_JOURNAL = process.env.NDJC_JOURNAL_REMOTE === '1';

const GH_OWNER  = process.env.GH_OWNER!;
const GH_REPO   = process.env.GH_REPO!;
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const GH_PAT    = process.env.GH_PAT!;

/** 生成 runId：稳定、文件夹安全 */
function newRunId(): string {
  // 形如 2025-09-13T06-57-31-972Z
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** 返回仓库根路径（在 Vercel/Node 环境下用项目工作目录即可） */
function getRepoPath(): string {
  return process.cwd();
}

async function putContentToGitHub(filePath: string, content: string, message: string) {
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(
    filePath
  )}`;
  const headers = {
    Authorization: `Bearer ${GH_PAT}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  } as const;

  // 先查是否存在以取 sha
  let sha: string | undefined;
  const head = await fetch(`${api}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers });
  if (head.ok) {
    const j = (await head.json().catch(() => undefined)) as any;
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

/** 写文本到本地/远端 journal */
async function writeText(runId: string, rel: string, txt: string) {
  const relPath = `requests/${runId}/${rel}`;

  if (REMOTE_JOURNAL) {
    await putContentToGitHub(relPath, txt, `[NDJC] write ${relPath}`);
    return;
  }

  const abs = path.join(process.cwd(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, txt, 'utf8');
}

/** 写 JSON 到本地/远端 journal */
async function writeJSON(runId: string, rel: string, obj: any) {
  await writeText(runId, rel, JSON.stringify(obj, null, 2));
}

/** 在 Vercel 环境下不再实际 git 提交，这里仅返回说明 */
async function gitCommitPush(_msg: string) {
  return { committed: REMOTE_JOURNAL, via: REMOTE_JOURNAL ? 'contents-api' : 'local-fs' };
}

/* -------------------- 导出 -------------------- */
// 具名导出（推荐）
export { newRunId, writeText, writeJSON, gitCommitPush, getRepoPath };

// 兼容默认导出（历史代码可能用过 default）
export default { newRunId, writeText, writeJSON, gitCommitPush, getRepoPath };
