import type { NextApiRequest, NextApiResponse } from 'next'
import { HttpsProxyAgent } from 'https-proxy-agent'
import fetch from 'node-fetch'

const agent = new HttpsProxyAgent('http://127.0.0.1:10810')
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const prompt = req.query.prompt || 'Hello'

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: String(prompt) }],
      }),
      agent: agent // ✅ 核心：走代理
    })

    if (!response.ok) {
      const error = await response.text()
      return res.status(500).json({ error })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || 'No response'
    res.status(200).json({ result: content })
  } catch (err: any) {
    console.error('❌ Fetch failed:', err)
    res.status(500).json({ error: err.message || 'Internal Server Error' })
  }
}
