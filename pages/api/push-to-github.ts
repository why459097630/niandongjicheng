// 文件路径：pages/api/push-to-github.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from '@octokit/rest';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const token = process.env.GITHUB_TOKEN;
  const owner = 'why459097630';
  const repo = 'niandongjicheng';
  const path = '1111111.txt'; // 要创建的文件路径
  const content = Buffer.from('这是一个由 ChatGPT 自动创建的测试文件。').toString('base64'); // Base64 编码的内容

  try {
    const octokit = new Octokit({ auth: token });

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: '创建 1111111.txt 测试文件',
      content,
      committer: {
        name: 'ChatGPT Bot',
        email: 'chatgpt@openai.com',
      },
      author: {
        name: 'ChatGPT Bot',
        email: 'chatgpt@openai.com',
      },
    });

    return res.status(200).json({ success: true, message: '✅ 文件创建成功！' });
  } catch (error: any) {
    console.error('❌ 创建失败：', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

export default handler;
