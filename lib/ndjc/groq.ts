// lib/ndjc/groq.ts
// 轻量封装 Groq Chat Completion。默认关闭“服务端 JSON 模式”，统一返回纯文本，必要时可手动开启。
// 环境变量：
//   - GROQ_API_KEY（必填）
//   - GROQ_MODEL（可选，默认 llama-3.1-8b-instant）
//   - NDJC_JSON_MODE=1  启用 JSON 模式（可选，不建议在方案A下开启）

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
  /** 可选：强制启用“服务端 JSON 模式”，默认关闭 */
  jsonMode?: boolean;
}

// Groq 的 OpenAI 兼容端点
const API_URL = "https://api.groq.com/openai/v1/chat/completions";

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
 * - 默认关闭“服务端 JSON 模式”（避免 LLM 输出含 XML/代码时触发 json_validate_failed）
 * - 对 429/5xx 做指数退避重试
 */
async function groqChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Missing GROQ_API_KEY"), { status: 500 });
  }

  const model = opts.model || process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const temperature = opts.temperature ?? 0;
  const top_p = opts.top_p ?? 1;
  const max_tokens = opts.max_tokens ?? 8192;
  const retries = Math.max(0, opts.retries ?? 4);

  // 默认关闭；env 或 opts 显式打开时才启 JSON 模式
  const jsonMode = opts.jsonMode === true || process.env.NDJC_JSON_MODE === "1";

  let lastErr: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 统一的请求体；是否附带 response_format 由 jsonMode 决定
      const body: Record<string, any> = {
        model,
        messages,
        temperature,
        top_p,
        max_tokens,  // 合同体量大，防截断
        stream: false,
      };
      if (jsonMode) {
        // 仅在明确需要时启用服务端 JSON 模式（会触发严格 JSON 校验）
        body.response_format = { type: "json_object" };
      }

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
