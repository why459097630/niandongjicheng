// lib/ndjc/github-writer.ts
import { Octokit } from "octokit";

export type Patch = { anchor: string; insert: string };
export type FileEdit =
  | {
      path: string;
      mode: "replace" | "create";
      contentBase64?: string;
      content?: string;
    }
  | { path: string; mode: "patch"; patches: Patch[] };

const OWNER  = process.env.GH_OWNER!;
const REPO   = process.env.GH_REPO!;
const BRANCH = process.env.GH_BRANCH || "main";

// 方式B：多命名兜底，三选一都可
const TOKEN =
  process.env.GITHUB_TOKEN ||
  process.env.GH_TOKEN ||
  process.env.GH_PAT;

if (!TOKEN) {
  throw new Error("Missing GitHub token (GITHUB_TOKEN/GH_TOKEN/GH_PAT).");
}

const octo = new Octokit({ auth: TOKEN });

async function getFile(refPath: string) {
  try {
    const res = await octo.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner: OWNER, repo: REPO, path: refPath, ref: BRANCH }
    );
    if (Array.isArray(res.data)) throw new Error("Path is a directory: " + refPath);
    const sha = (res.data as any).sha as string;
    const content = Buffer.from((res.data as any).content, "base64").toString("utf8");
    return { sha, content };
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

/* -------------------- strings.xml 智能“去重 + 覆盖” -------------------- */

/** 解析插入块里的 <string name="...">value</string> 列表（后出现的覆盖先前的） */
function parseStrings(insertBlock: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(insertBlock)) !== null) {
    map[m[1]] = m[2];
  }
  return map;
}

/** 在 strings.xml 文本中为若干 key 做“去重并只保留一条（覆盖值）” */
function upsertStringsXml(xml: string, kv: Record<string, string>): string {
  let out = xml;
  // 确保有 <resources> 容器
  if (!/<resources[\s>]/.test(out)) out = `<resources>\n${out}\n</resources>\n`;

  for (const [name, value] of Object.entries(kv)) {
    // 1) 删除所有同名项（去重）
    const existAll = new RegExp(`<string\\s+name="${name}">[\\s\\S]*?<\\/string>`, "g");
    out = out.replace(existAll, "");
    // 2) 追加一条到 </resources> 前
    out = out.replace(
      /<\/resources>\s*$/i,
      `  <string name="${name}">${value}</string>\n</resources>`
    );
  }

  // 3) 清理多余空行
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

/** 对单个文件应用补丁：strings.xml 走智能 upsert；其他文件按锚点插入 */
function applyPatches(filePath: string, text: string, patches: Patch[]): string {
  // strings.xml：聚合所有 <string> 项后统一 upsert
  if (/[/\\]values[/\\]strings\.xml$/.test(filePath)) {
    let merged = text;
    const kv: Record<string, string> = {};
    for (const p of patches) Object.assign(kv, parseStrings(p.insert));
    return upsertStringsXml(merged, kv);
  }

  // 其他文件：按锚点插入
  let out = text;
  for (const p of patches) {
    const m = p.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(//\\s*${m}|/\\*\\s*${m}\\s*\\*/|<!--\\s*${m}\\s*-->)`);
    if (!re.test(out)) throw new Error(`Anchor not found: ${p.anchor}`);
    out = out.replace(re, (hit) => `${hit}\n${p.insert}`);
  }
  return out;
}

/* -------------------- 提交改动 -------------------- */

export async function commitEdits(edits: FileEdit[], commitMsg: string) {
  // 获取基准 tree
  const head = await octo.request("GET /repos/{owner}/{repo}/git/refs/heads/{branch}", {
    owner: OWNER, repo: REPO, branch: BRANCH
  });
  const latestCommitSha = (head.data as any).object.sha;

  const latestCommit = await octo.request(
    "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
    { owner: OWNER, repo: REPO, commit_sha: latestCommitSha }
  );
  const baseTreeSha = (latestCommit.data as any).tree.sha;

  const blobs: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];

  for (const e of edits) {
    if (e.mode === "patch") {
      const prev = await getFile(e.path);
      if (!prev) throw new Error(`Target file not found for patch: ${e.path}`);
      const next = applyPatches(e.path, prev.content, e.patches);
      const blob = await octo.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner: OWNER, repo: REPO, content: next, encoding: "utf-8"
      });
      blobs.push({ path: e.path, mode: "100644", type: "blob", sha: (blob.data as any).sha });
    } else {
      const content =
        e.content ??
        (e.contentBase64 ? Buffer.from(e.contentBase64, "base64").toString("utf8") : "");
      const blob = await octo.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner: OWNER, repo: REPO, content, encoding: "utf-8"
      });
      blobs.push({ path: e.path, mode: "100644", type: "blob", sha: (blob.data as any).sha });
    }
  }

  const tree = await octo.request("POST /repos/{owner}/{repo}/git/trees", {
    owner: OWNER, repo: REPO, base_tree: baseTreeSha, tree: blobs
  });

  const commit = await octo.request("POST /repos/{owner}/{repo}/git/commits", {
    owner: OWNER, repo: REPO,
    message: commitMsg,
    tree: (tree.data as any).sha,
    parents: [latestCommitSha]
  });

  await octo.request("PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}", {
    owner: OWNER, repo: REPO, branch: BRANCH, sha: (commit.data as any).sha, force: true
  });
}

export async function touchRequestFile(requestId: string, payload: any = {}) {
  const p = `requests/${requestId}.json`;
  const content = JSON.stringify({ requestId, ...payload, ts: Date.now() }, null, 2);
  const edit: FileEdit = { path: p, mode: "create", content };
  await commitEdits([edit], `NDJC: request ${requestId}`);
}
