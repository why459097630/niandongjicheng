// /pages/api/push-to-github.ts
import { Octokit } from "@octokit/rest";
import type { NextApiRequest, NextApiResponse } from "next";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN, // 你已经配置了 token
});

const OWNER = "why459097630"; // GitHub 用户名
const BRANCH = "main";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { repo, path, content, message, action = "upsert" } = req.body;

  if (!repo || !path) {
    return res.status(400).json({ error: "Missing repo or path." });
  }

  try {
    let sha: string | undefined = undefined;

    // 尝试获取文件的 SHA（用于修改和删除）
    try {
      const { data } = await octokit.repos.getContent({
        owner: OWNER,
        repo,
        path,
      });

      if (!Array.isArray(data) && data.sha) {
        sha = data.sha;
      }
    } catch (err: any) {
      if (err.status === 404 && action === "upsert") {
        // 文件不存在时创建，SHA 为空
        sha = undefined;
      } else if (action === "delete") {
        return res.status(404).json({ error: "File not found to delete." });
      } else {
        throw err;
      }
    }

    // 执行对应操作
    if (action === "delete") {
      if (!sha) return res.status(400).json({ error: "Cannot delete a non-existing file." });

      await octokit.repos.deleteFile({
        owner: OWNER,
        repo,
        path,
        message: message || `delete ${path}`,
        sha,
        branch: BRANCH,
      });

      return res.status(200).json({ status: "deleted" });
    }

    // 创建或更新文件
    const result = await octokit.repos.createOrUpdateFileContents({
      owner: OWNER,
      repo,
      path,
      message: message || `update ${path}`,
      content: Buffer.from(content || "").toString("base64"),
      sha,
      branch: BRANCH,
    });

    return res.status(200).json({ status: sha ? "updated" : "created", url: result.data.content?.html_url });
  } catch (err: any) {
    console.error("GitHub 操作失败：", err.message);
    return res.status(500).json({ error: err.message });
  }
}