import type { NextApiRequest, NextApiResponse } from "next";
import { Octokit } from "@octokit/rest";
import JSZip from "jszip";

const owner = "why459097630"; // 你的 GitHub 用户名
const repo = "Packaging-warehouse"; // APK 打包仓库名
const branch = "main"; // 推送目标分支
const targetPath = "app"; // 推送到仓库的文件夹路径

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "GitHub token not found" });
  }

  const { html, css, js } = req.body;
  if (!html || !css || !js) {
    return res.status(400).json({ error: "Missing html/css/js" });
  }

  try {
    const octokit = new Octokit({ auth: token });

    // 获取最新 commit 和 tree
    const { data: latestCommit } = await octokit.repos.getCommit({
      owner,
      repo,
      ref: branch,
    });

    const baseTree = latestCommit.commit.tree.sha;

    // 构造文件结构（main.html + assets）
    const files = [
      {
        path: `${targetPath}/index.html`,
        content: html,
      },
      {
        path: `${targetPath}/style.css`,
        content: css,
      },
      {
        path: `${targetPath}/script.js`,
        content: js,
      },
    ];

    // 创建 blob 和 tree
const blobs = await Promise.all(
  files.map(async (file) => {
    const blob = await octokit.git.createBlob({
      owner,
      repo,
      content: file.content,
      encoding: "utf-8",
    });
    return {
      path: file.path,
      mode: "100644" as const, // 修复点
      type: "blob" as const,
      sha: blob.data.sha,
    };
  })
);


    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTree,
      tree: blobs,
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: "🤖 Auto upload from niandongjicheng",
      tree: newTree.sha,
      parents: [latestCommit.sha],
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
      force: true,
    });

    return res.status(200).json({ success: true, message: "Uploaded and committed successfully" });
  } catch (error: any) {
    console.error("Upload failed:", error.message);
    return res.status(500).json({ error: "Failed to upload to GitHub" });
  }
}
