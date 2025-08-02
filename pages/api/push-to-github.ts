// pages/api/push-to-github.ts
import { Octokit } from "@octokit/rest";
import type { NextApiRequest, NextApiResponse } from "next";

// 从环境变量读取你的 GitHub Token
const GITHUB_TOKEN = process.env.GITHUB_TOKEN as string;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { repo, filePath, content, commitMessage, secret } = req.body;

  // 防止滥用，加密验证（可自定义）
  if (secret !== process.env.API_SECRET) {
    return res.status(403).json({ error: "Invalid secret" });
  }

  try {
    const [owner, repoName] = repo.split("/");

    // 读取现有文件的 SHA（如果存在）
    let sha = undefined;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo: repoName,
        path: filePath,
      });
      sha = (data as any).sha;
    } catch (_) {}

    // 创建或更新文件
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path: filePath,
      message: commitMessage,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha, // 如果没有就表示新文件
    });

    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
