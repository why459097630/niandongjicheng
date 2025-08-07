import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
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
    // 请求 OpenAI 生成代码
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo', // 可改成 gpt-4
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

    // 简单提取 HTML/CSS/JS（可优化为正则）
    const html = content.split('【HTML】')[1]?.split('【')[0]?.trim() || '';
    const css = content.split('【CSS】')[1]?.split('【')[0]?.trim() || '';
    const js = content.split('【JS】')[1]?.trim() || '';

    // 生成 HTML 预览页面
    const htmlPath = path.join(process.cwd(), 'public', 'app.html');
    const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Preview</title>
  <style>${css}</style>
</head>
<body>
${html}
<script>${js}</script>
</body>
</html>`;
    fs.writeFileSync(htmlPath, previewHtml, 'utf-8');

    // 保存历史记录
    const historyPath = path.join(process.cwd(), 'data', 'history.json');
    const history = fs.existsSync(historyPath)
      ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
      : [];
    history.push({ id: Date.now(), prompt, html, css, js, createdAt: new Date().toISOString() });
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');

    // 生成 ZIP 文件
    const zip = new JSZip();
    zip.file('index.html', html);
    zip.file('style.css', css);
    zip.file('script.js', js);

    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
    const zipPath = path.join(process.cwd(), 'public', 'app.zip');
    fs.writeFileSync(zipPath, zipContent);

    // 返回结果
    res.status(200).json({
      message: 'App generated successfully',
      html,
      previewUrl: '/app.html',
      zipUrl: '/app.zip',
    });
  } catch (err: any) {
    console.error('OpenAI error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate app' });
  }
}
