// lib/ndjc/groq.ts
export type GroqTrace = {
  provider: 'groq';
  url: string;
  model: string;
  request: any;     // 发给 Groq 的 body
  response: any;    // Groq 的原始 JSON 返回
  text: string;     // choices[0].message.content
  finish_reason?: string;
  usage?: any;
};

export async function groqChat(
  messages: Array<{role:'system'|'user'|'assistant', content:string}>,
  opts: { json?: boolean; temperature?: number } = {}
): Promise<{ text: string; trace: GroqTrace }> {
  const key  = process.env.GROQ_API_KEY!;
  const url  = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';
  const body = {
    model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
    messages,
    temperature: opts.temperature ?? 0.2,
    response_format: opts.json ? { type: 'json_object' } : undefined,
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

  const raw = await res.json().catch(async () => ({ text: await res.text() }));
  const text = raw?.choices?.[0]?.message?.content ?? '';

  return {
    text,
    trace: {
      provider: 'groq',
      url,
      model: body.model,
      request: body,
      response: raw,
      text,
      finish_reason: raw?.choices?.[0]?.finish_reason,
      usage: raw?.usage,
    },
  };
}
