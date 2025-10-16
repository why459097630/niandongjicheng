// lib/ndjc/groq.ts
// 轻量封装 Groq Chat Completion，避免 SDK 依赖问题；统一返回纯文本
// 环境变量：GROQ_API_KEY（必填）、GROQ_MODEL（可选，默认 llama-3.1-8b-instant）

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOpts {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  model?: string;
}

const API_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * 与 OpenAI Chat Completions 兼容的 Groq API：
 * - 返回首条 message 的 content（字符串）
 * - 关闭流式，统一简单用法
 * - 默认开启 JSON 输出约束（与 Playground 的 JSON Mode 一致）
 */
async function groqChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const model = opts.model || process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    top_p: opts.top_p ?? 0,            // 对齐 Playground：严格确定性
    max_tokens: opts.max_tokens ?? 4096, // 防截断：NDJC 合同较长
    stream: false,                     // 一律关闭流式，避免中途截断/拼接
    response_format: { type: "json_object" }, // 与 Playground JSON Mode 等价
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq HTTP ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json();
  const content =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.delta?.content ??
    "";

  return typeof content === "string" ? content : String(content ?? "");
}

// 兼容多种导入写法
export { groqChat };
export { groqChat as callGroqChat };
export default groqChat;
