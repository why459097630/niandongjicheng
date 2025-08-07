import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  try {
    // 1. 向 OpenAI 请求生成 HTML/CSS/JS
    const completion = await openai.chat.completions.create({
      model: 'gpt-4', // 你也可以改回 gpt-3.5-turbo
      messages: [
        {
          role: 'user',
          content: `请根据以下描述生成一个 App 的前端代码，包含 HTML、CSS 和 JavaScript，并用以下格式返回：

【HTML】
<!DOCTYPE html>...
【CSS】
body { ... }
【JS】
console.log("...");

描述如下：
${prompt}`,
        },
      ],
    });

    const content = completion.choices[0].message?.content || '';
    const html = content.split('【HTML】')[1]?.split('【')[0]?.trim() || '';
    const css = content.split('【CSS】')[1]?.split('【')[0]?.trim() || '';
    const js = content.split('【JS】')[1]?.trim() || '';

    // 2. 推送到 APK 打包仓库
    const timestamp = Date.now();
    const subDir = `app-${timestamp}`;
    const pushRes = await fetch('https://niandongjicheng.vercel.app/api/push-to-github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: 'Packaging-warehouse',
        branch: 'main',
        path: `${subDir}/src/main/assets/www`, // 放进 Android WebView 的 HTML 路径
        files: [
          { path: 'index.html', content: html },
          { path: 'style.css', content: css },
          { path: 'script.js', content: js },
        ],
        commitMsg: `feat: 自动生成 App - ${prompt}`,
      }),
    });

    if (!pushRes.ok) {
      const err = await pushRes.text();
      throw new Error(`推送失败：${err}`);
    }

    // 3. 构造下载链接
    const apkUrl = `https://nightly.link/why459097630/Packaging-warehouse/workflows/build/main/app-release.apk`;

    // 4. 返回结果给前端
    res.status(200).json({
      message: 'App generated and pushed successfully',
      html,
      previewUrl: '/app.html',  // 可选：前端展示 AI 生成内容
      zipUrl: apkUrl,
    });
  } catch (err: any) {
    console.error('OpenAI or push error:', err);
    res.status(500).json({ error: err.message || '生成失败' });
  }
}
