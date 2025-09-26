// server/integrations/githubTree.ts
import { Octokit } from "@octokit/rest";
import fs from "fs";
import path from "path";

export async function commitChangesAsTree(opts: {
  owner: string; repo: string; baseRef: string;  // e.g. heads/ndjc-run/xxxx
  repoRoot: string;                              // 工作树根
  changedFiles: string[];                        // 相对 repoRoot 的路径列表
  token: string;                                 // GitHub token
  message: string;
}) {
  const octokit = new Octokit({ auth: opts.token });
  const { data: ref } = await octokit.git.getRef({ owner: opts.owner, repo: opts.repo, ref: opts.baseRef });

  const baseCommitSha = ref.object.sha;
  const { data: baseCommit } = await octokit.git.getCommit({ owner: opts.owner, repo: opts.repo, commit_sha: baseCommitSha });

  // 1) 创建 blobs
  const blobs = await Promise.all(opts.changedFiles.map(async (p) => {
    const abs = path.join(opts.repoRoot, p);
    const content = fs.readFileSync(abs);
    const { data: blob } = await octokit.git.createBlob({
      owner: opts.owner, repo: opts.repo,
      content: content.toString("base64"), encoding: "base64"
    });
    return { path: p, sha: blob.sha, mode: "100644", type: "blob" as const };
  }));

  // 2) 创建 tree
  const { data: tree } = await octokit.git.createTree({
    owner: opts.owner, repo: opts.repo,
    tree: blobs, base_tree: baseCommit.tree.sha
  });

  // 3) 创建 commit
  const { data: commit } = await octokit.git.createCommit({
    owner: opts.owner, repo: opts.repo,
    message: opts.message, tree: tree.sha, parents: [baseCommitSha]
  });

  // 4) 更新 ref
  await octokit.git.updateRef({
    owner: opts.owner, repo: opts.repo, ref: opts.baseRef,
    sha: commit.sha, force: true
  });

  return commit.sha;
}
