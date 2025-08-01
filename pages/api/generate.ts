import type { NextApiRequest, NextApiResponse } from 'next'

type Data = {
  html: string
  css: string
  js: string
  apkUrl: string
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const { prompt } = req.body

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Invalid prompt' })
  }

  // ✅ 模拟返回 AI 生成的 HTML/CSS/JS 和 APK 下载链接
  res.status(200).json({
    html: `<div style="padding: 2rem;"><h1>${prompt}</h1><p>This is a mock app generated for you!</p></div>`,
    css: `body { background: #fafafa; font-family: sans-serif; color: #333; }`,
    js: `console.log("App prompt: ${prompt}");`,
    apkUrl: `https://example.com/fake-${Date.now()}.apk`
  })
}
