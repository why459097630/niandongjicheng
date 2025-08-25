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

/** 针对 strings.xml：如果插入包含已存在的 <string name="...">，则覆盖其值而不是重复追加 */
function upsertAndroidStringsXML(xml: string, insertBlock: string): string {
  // 找出 insertBlock 里的多个 <string name="xxx">value</string>
  const itemRe = /<string\s+name="([^"]+)">([\s\S]*?)<\/string>/g;
  let out = xml;
  let m: RegExpExecArray | null;

  // 预处理：确保 xml 有 <resources> … </resources>
  if (!/<resources[\s>]/.test(out)) {
    out = `<resources>\n${out}\n</resources>\n`;
  }

  while ((m = itemRe.exec(insertBlock)) !== null) {
    const name = m[1];
    const value = m[2];
    const existRe = new RegExp(
      `<string\\s+name="${name}">[\\s\\S]*?<\\/string>`,
      "g"
    );
    if (existRe.test(out)) {
      // 覆盖
      out = out.replace(existRe, `<string name="${name}">${value}</string>`);
    } else {
      // 追加到 </resources> 之前
      out = out.replace(
        /<\/resources>\s*$/i,
        `  <string name="${name}">${value}</string>\n</resources>`
      );
    }
  }
  return out;
}

function applyPatches(filePath: string, text: string, patches: Patch[]): string {
  // strings.xml 特判：先合并/去重要插入的 <string> 项
  if (filePath.endsWith("/values/strings.xml") || filePath.endsWith("\\values\\strings.xml")) {
    // 聚合所有要插入的 <string ...>…</string>，进行 upsert
    let merged = text;
    for (const p of patches) {
      merged = upsertAndroidStringsXML(merged, p.insert);
    }
    return merged;
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

export async function commitEdits(edits: FileEdit[], commitMsg: string) {
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
