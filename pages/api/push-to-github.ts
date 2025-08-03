// pages/api/push-to-github.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || '你的 GitHub Token',
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { repo, path, content, message } = req.body;

  try {
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: 'why459097630',
      repo,
      path,
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      committer: {
        name: 'ChatGPT Bot',
        email: 'bot@example.com',
      },
      author: {
        name: 'ChatGPT Bot',
        email: 'bot@example.com',
      },
    });

    res.status(200).json({ success: true, url: response.data.content?.html_url });
  } catch (error: any) {
    console.error('GitHub 上传失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
