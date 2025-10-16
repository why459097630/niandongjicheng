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
  /** 最大重试次数（仅对 429 / 5xx 生效）；默认 4 次 */
  retries?: number;
}

const API_URL = "https://api/groq.com/openai/v1/chat/completions".replace(
  "https://api/groq.com",
  "https://api.groq.com"
);

/** 生成带抖动的指数退避时间（毫秒） */
function backoff(attempt: number) {
  const base = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s...
  const jitter = Math.floor(Math.random() * 250); // 0-250ms
  return base + jitter;
}

/**
 * 与 OpenAI Chat Completions 兼容的 Groq API：
 * - 返回首条 message 的 content（字符串）
 * - 关闭流式，统一简单用法
 * - 开启 JSON 输出约束（与 Playground 的 JSON Mode 一致）
 * - 对 429/5xx 做指数退避重试
 */
async function groqChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Missing GROQ_API_KEY"), { status: 500 });
  }

  const model = opts.model || process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const temperature = opts.temperature ?? 0;
  const top_p = opts.top_p ?? 0;
  const max_tokens = opts.max_tokens ?? 4096;
  const retries = Math.max(0, opts.retries ?? 4);

  let lastErr: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const body = {
        model,
        messages,
        temperature,
        top_p,                 // 对齐 Playground：确定性采样
        max_tokens,            // 合同体量大，防截断
        stream: false,         // 关闭流式，避免拼接/截断
        response_format: { type: "json_object" }, // 等价 JSON Mode
      };

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const requestId = res.headers.get("x-request-id") || res.headers.get("x-requestid") || "";
      const isRetryable = res.status === 429 || res.status >= 500;

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        const err = Object.assign(
          new Error(`Groq HTTP ${res.status}${requestId ? ` (req ${requestId})` : ""}: ${txt || res.statusText}`),
          { status: res.status, requestId, bodyText: txt }
        );
        if (isRetryable && attempt < retries) {
          await new Promise((r) => setTimeout(r, backoff(attempt)));
          lastErr = err;
          continue;
        }
        throw err;
      }

      const json = await res.json().catch(() => ({}));
      const content =
        json?.choices?.[0]?.message?.content ??
        json?.choices?.[0]?.delta?.content ??
        "";

      return typeof content === "string" ? content : String(content ?? "");
    } catch (e: any) {
      // 网络异常 / 解析错误：也重试
      const status = e?.status ?? 0;
      const retryable = status === 0 || status === 429 || status >= 500;
      if (retryable && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoff(attempt)));
        lastErr = e;
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error("Groq call failed without specific error");
}

// 兼容多种导入写法
export { groqChat };
export { groqChat as callGroqChat };
export default groqChat;
