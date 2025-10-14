// lib/ndjc/groq.ts
import Groq from "groq-sdk";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type ChatOpts = {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
};

const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_TOKEN;
if (!apiKey) {
  console.warn("[NDJC:groq] GROQ_API_KEY missing");
}

const client = new Groq({ apiKey: apiKey || "" });

// 始终返回“纯字符串”的助手回复
export async function groqChat(messages: ChatMsg[], opts: ChatOpts = {}): Promise<string> {
  const model = process.env.NDJC_MODEL || "llama-3.1-8b-instant";

  const payload: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.max_tokens ?? 1024,
    top_p: opts.top_p ?? 1,
    stream: opts.stream ?? false,
  };

  // 不使用 JSON 模式，由我们自己去解析，避免空/null
  try {
    if (payload.stream) {
      const stream = await client.chat.completions.create(payload);
      let out = "";
      // SDK 的流式用法：遍历 chunks，累加 delta.content
      // 兼容一下“不是流式”的情况（某些 SDK 版本 stream:true 也会直接返回完整对象）
      // @ts-ignore
      if (typeof stream?.[Symbol.asyncIterator] === "function") {
        // @ts-ignore
        for await (const chunk of stream) {
          const d = chunk?.choices?.[0]?.delta?.content ?? "";
          if (typeof d === "string") out += d;
        }
        return out;
      } else {
        const text = stream?.choices?.[0]?.message?.content ?? "";
        return typeof text === "string" ? text : "";
      }
    } else {
      const res = await client.chat.completions.create(payload);
      const text = res?.choices?.[0]?.message?.content ?? "";
      return typeof text === "string" ? text : "";
    }
  } catch (e: any) {
    // 抛给上层，由 orchestrator 做兜底
    throw new Error(`[NDJC:groq] chat failed: ${e?.message || e}`);
  }
}
