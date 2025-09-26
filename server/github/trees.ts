// server/github/trees.ts
import fs from "node:fs";
import path from "node:path";
import { gh } from "./client";
import { cfg } from "../config";

function* walk(dir: string, base = dir): Generator<{path: string, content: string}> {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(base, abs);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) yield* walk(abs, base);
    else {
      const text = fs.readFileSync(abs, "utf8");
      // Node16 的 lib 没有 replaceAll，这里用正则保证兼容
      const unixRel = rel.replace(/\\/g, "/");
      yield { path: unixRel, content: text };
    }
  }
}

export async function upsertRunBranchFromDirs(
  runId: string,
  appDir: string,
  reqDir: string | null,
  branchName?: string
) {
  const baseRef = await gh.rest.git.getRef({
    owner: cfg.owner, repo: cfg.repo, ref: `heads/${cfg.baseRef}`
  });
  const baseSha = baseRef.data.object.sha;
  const refName = branchName || `${cfg.branchPrefix}/${runId}`;

  // 创建运行分支（已存在忽略）
  try {
    await gh.rest.git.createRef({
      owner: cfg.owner, repo: cfg.repo, ref: `refs/heads/${refName}`, sha: baseSha
    });
  } catch {}

  // 组装 tree：app/** 与 requests/<runId>/** 均入 tree
  const blobs: {path: string, content: string}[] = [];
  for (const b of walk(appDir))        blobs.push({ path: `app/${b.path}`,                 content: b.content });
  if (reqDir) for (const b of walk(reqDir)) blobs.push({ path: `requests/${runId}/${b.path}`, content: b.content });

  const baseCommit = await gh.rest.repos.getCommit({
    owner: cfg.owner, repo: cfg.repo, ref: cfg.baseRef
  });

  const tree = await gh.rest.git.createTree({
    owner: cfg.owner, repo: cfg.repo,
    base_tree: baseCommit.data.commit.tree.sha,
    tree: blobs.map(b => ({ path: b.path, mode: "100644", type: "blob", content: b.content }))
  });

  const commit = await gh.rest.git.createCommit({
    owner: cfg.owner, repo: cfg.repo,
    message: `[NDJC ${runId}] materialize app & requests`,
    tree: tree.data.sha, parents: [baseSha]
  });

  await gh.rest.git.updateRef({
    owner: cfg.owner, repo: cfg.repo, ref: `heads/${refName}`,
    sha: commit.data.sha, force: true
  });

  return { refName, commitSha: commit.data.sha, files: blobs.length };
}
