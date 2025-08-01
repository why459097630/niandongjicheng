import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// 模拟生成 HTML/CSS/JS（你可以改成真实调用）
function mockGenerateCode(prompt: string) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${prompt}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <h1>${prompt}</h1>
    <button onclick="alert('Hello')">Click Me</button>
  </div>
  <script src="script.js"></script>
</body>
</html>`;

  const css = `body { font-family: sans-serif; background: #f0f0f0; text-align: center; padding: 50px; }
button { padding: 10px 20px; font-size: 16px; }`;

  const js = `console.log("App Loaded");`;

  return { html, css, js };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST requests allowed' });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }

  // 模拟生成代码
  const { html, css, js } = mockGenerateCode(prompt);

  // 写入到 public/app.html
  const htmlPath = path.join(process.cwd(), 'public', 'app.html');
  const htmlContent = `<!DOCTYPE html>
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
  fs.writeFileSync(htmlPath, htmlContent, 'utf-8');

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
  zipUrl: '/app.zip'
});
}
