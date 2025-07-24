import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { prompt } = req.body;

  const apiBase = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: `Generate the main code file for: ${prompt}` }],
    }),
  });

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content || 'Failed to generate code.';
  res.status(200).json({ code: content });
}
