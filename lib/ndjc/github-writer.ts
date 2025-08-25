import { Octokit } from "octokit";
import * as path from "node:path";

export type Patch = { anchor: string; insert: string };
export type FileEdit =
  | { path: string; mode: "replace" | "create"; contentBase64?: string; content?: string }
  | { path: string; mode: "patch"; patches: Patch[] };

const OWNER = process.env.GH_OWNER!;
const REPO = process.env.GH_REPO!;
const BRANCH = process.env.GH_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN!;

const octo = new Octokit({ auth: TOKEN });

async function getFile(refPath: string) {
  try {
    const res = await octo.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: OWNER, repo: REPO, path: refPath, ref: BRANCH
    });
    if (Array.isArray(res.data)) throw new Error("Path is a directory: " + refPath);
    const sha = (res.data as any).sha as string;
    const content = Buffer.from((res.data as any).content, "base64").toString("utf8");
    return { sha, content };
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

function applyPatches(text: string, patches: Patch[]): string {
  let out = text;
  for (const p of patches) {
    const m = p.anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(//\\s*${m}|/\\*\\s*${m}\\s*\\*/|<!--\\s*${m}\\s*-->)`
    );
    if (!re.test(out)) {
      throw new Error(`Anchor not found: ${p.anchor}`);
    }
    out = out.replace(re, (hit) => `${hit}\n${p.insert}`);
  }
  return out;
}

export async function commitEdits(edits: FileEdit[], commitMsg: string) {
  // get latest commit sha/tree
  const head = await octo.request("GET /repos/{owner}/{repo}/git/refs/heads/{branch}", {
    owner: OWNER, repo: REPO, branch: BRANCH
  });
  const latestCommitSha = (head.data as any).object.sha;
  const latestCommit = await octo.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
    owner: OWNER, repo: REPO, commit_sha: latestCommitSha
  });
  const baseTreeSha = (latestCommit.data as any).tree.sha;

  const blobs: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];

  for (const e of edits) {
    if (e.mode === "patch") {
      const prev = await getFile(e.path);
      if (!prev) throw new Error(`Target file not found for patch: ${e.path}`);
      const next = applyPatches(prev.content, e.patches);
      const blob = await octo.request("POST /repos/{owner}/{repo}/git/blobs", {
        owner: OWNER, repo: REPO, content: next, encoding: "utf-8"
      });
      blobs.push({ path: e.path, mode: "100644", type: "blob", sha: (blob.data as any).sha });
    } else {
      const content = e.content ?? (e.contentBase64 ? Buffer.from(e.contentBase64, "base64").toString("utf8") : "");
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
  // create or replace
  const existing = await getFile(p);
  const content = JSON.stringify({ requestId, ...payload, ts: Date.now() }, null, 2);
  const edit: FileEdit = { path: p, mode: existing ? "replace" : "create", content };
  await commitEdits([edit], `NDJC: request ${requestId}`);
}
