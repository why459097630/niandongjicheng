// lib/ndjc/github-writer.ts
import { Octokit } from "octokit";

// —— 类型
export type Patch = { anchor: string; insert: string };
export type FileEdit =
  | {
      path: string;
      mode: "replace" | "create";
      contentBase64?: string;
      content?: string;
    }
  | { path: string; mode: "patch"; patches: Patch[] };

type GitBlob = { path: string; mode: "100644"; type: "blob"; sha: string };

// —— 环境
const OWNER = process.env.GH_OWNER!;
const REPO = process.env.GH_REPO!;
const BRANCH = process.env.GH_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN!;
if (!OWNER || !REPO || !TOKEN) {
  console.warn("[github-writer] Missing GH_OWNER/GH_REPO/GITHUB_TOKEN");
}
const octo = new Octokit({ auth: TOKEN });

// —— 读文件
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

// —— 对文件应用补丁，并统计每个锚点是否命中
function applyPatchesWithHits(text: string, patches: Patch[]) {
  let out = text;
  const hits: { anchor: string; found: boolean }[] = [];
  for (const p of patches) {
    const m = p.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(//\\s*${m}|/\\*\\s*${m}\\s*\\*/|<!--\\s*${m}\\s*-->)`
    );
    const found = re.test(out);
    hits.push({ anchor: p.anchor, found });
    if (!found) throw new Error(`Anchor not found: ${p.anchor}`);
    out = out.replace(re, (hit) => `${hit}\n${p.insert}`);
  }
  return { text: out, hits };
}

// —— 提交改动（支持 patch/create/replace），返回 anchors 命中审计
export async function commitEdits(
  edits: FileEdit[],
  commitMsg: string
): Promise<{ audit: any[]; commitSha: string }> {
  // 1) 获取当前 HEAD 与 base tree
  const head = await octo.request(
    "GET /repos/{owner}/{repo}/git/refs/heads/{branch}",
    { owner: OWNER, repo: REPO, branch: BRANCH }
  );
  const latestCommitSha = (head.data as any).object.sha;
  const latestCommit = await octo.request(
    "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
    { owner: OWNER, repo: REPO, commit_sha: latestCommitSha }
  );
  const baseTreeSha = (latestCommit.data as any).tree.sha;

  // 2) 逐个生成 blob，并记录审计信息
  const blobs: GitBlob[] = [];
  const audit: any[] = [];

  for (const e of edits) {
    if (e.mode === "patch") {
      const prev = await getFile(e.path);
      if (!prev) throw new Error(`Target file not found for patch: ${e.path}`);

      const { text: next, hits } = applyPatchesWithHits(prev.content, e.patches);
      audit.push({ path: e.path, mode: "patch", anchors: hits });

      const blob = await octo.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner: OWNER,
        repo: REPO,
        content: next,
        encoding: "utf-8",
      });
      blobs.push({
        path: e.path,
        mode: "100644",
        type: "blob",
        sha: (blob.data as any).sha,
      });
    } else {
      // create/replace 文本内容
      const content =
        e.content ??
        (e.contentBase64
          ? Buffer.from(e.contentBase64, "base64").toString("utf8")
          : "");
      audit.push({ path: e.path, mode: e.mode });

      const blob = await octo.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner: OWNER,
        repo: REPO,
        content,
        encoding: "utf-8",
      });
      blobs.push({
        path: e.path,
        mode: "100644",
        type: "blob",
        sha: (blob.data as any).sha,
      });
    }
  }

  // 3) 创建树、提交、移动引用
  const tree = await octo.request("POST /repos/{owner}/{repo}/git/trees", {
    owner: OWNER,
    repo: REPO,
    base_tree: baseTreeSha,
    tree: blobs,
  });

  const commit = await octo.request("POST /repos/{owner}/{repo}/git/commits", {
    owner: OWNER,
    repo: REPO,
    message: commitMsg,
    tree: (tree.data as any).sha,
    parents: [latestCommitSha],
  });

  await octo.request("PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}", {
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    sha: (commit.data as any).sha,
    force: true,
  });

  return { audit, commitSha: (commit.data as any).sha };
}

// —— 触发构建：创建一个最简单的请求文件
export async function touchRequestFile(requestId: string, payload: any = {}) {
  const content = JSON.stringify({ requestId, ...payload, ts: Date.now() }, null, 2);
  await commitEdits(
    [{ path: `requests/${requestId}.json`, mode: "create", content }],
    `NDJC:${requestId} trigger build`
  );
}
