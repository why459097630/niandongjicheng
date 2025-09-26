import fs from "node:fs";
import path from "node:path";
import { gh } from "./client";
import { cfg } from "../config";

function* walk(dir: string, base = dir): Generator<{ path: string; content: string }> {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(base, abs);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      yield* walk(abs, base);
    } else {
      // 用正则版代替 replaceAll，兼容较低 TS lib/target
      const relUnix = rel.replace(/\\/g, "/");
      yield { path: relUnix, content: fs.readFileSync(abs, "utf8") };
    }
  }
}

export async function upsertRunBranchWithTree(runId: string, repoRoot: string) {
  const baseRef = await gh.rest.git.getRef({
    owner: cfg.owner,
    repo: cfg.repo,
    ref: `heads/${cfg.baseRef}`,
  });
  const baseSha = baseRef.data.object.sha;

  // 1) 创建运行分支
  const refName = `${cfg.branchPrefix}/${runId}`;
  try {
    await gh.rest.git.createRef({
      owner: cfg.owner,
      repo: cfg.repo,
      ref: `refs/heads/${refName}`,
      sha: baseSha,
    });
  } catch (_) {
    /* 已存在则继续 */
  }

  // 2) 组装 tree（基于 base_tree）
  const baseCommit = await gh.rest.repos.getCommit({
    owner: cfg.owner,
    repo: cfg.repo,
    ref: cfg.baseRef,
  });
  const blobs = [
    ...walk(path.join(repoRoot, "app")),
    ...walk(path.join(repoRoot, "requests")),
  ];

  const tree = await gh.rest.git.createTree({
    owner: cfg.owner,
    repo: cfg.repo,
    base_tree: baseCommit.data.commit.tree.sha,
    tree: blobs.map((b) => ({
      path: b.path.startsWith("app/") ? b.path : `requests/${runId}/${b.path}`,
      mode: "100644",
      type: "blob",
      content: b.content,
    })),
  });

  // 3) commit
  const commit = await gh.rest.git.createCommit({
    owner: cfg.owner,
    repo: cfg.repo,
    message: `[NDJC ${runId}] materialize app & requests`,
    tree: tree.data.sha,
    parents: [baseSha],
  });

  // 4) 更新分支指针
  await gh.rest.git.updateRef({
    owner: cfg.owner,
    repo: cfg.repo,
    ref: `heads/${refName}`,
    sha: commit.data.sha,
    force: true,
  });

  return { refName, commitSha: commit.data.sha };
}
