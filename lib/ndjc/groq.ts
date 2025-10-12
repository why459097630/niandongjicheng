// lib/ndjc/groq.ts

export type GroqTrace = {
  provider: "groq";
  url: string;
  model: string;
  request: any;   // 请求体（已发出的 body）
  response: any;  // Groq 原始 JSON 返回
  text: string;   // 提取到的 content 文本
  finish_reason?: string;
  usage?: any;
};

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type ChatOpts = {
  /** 兼容旧调用；此版本已强制 JSON 输出，此项将被忽略 */
  json?: boolean;
  /** 兼容旧调用；此版本固定为 0，如需覆盖请在此文件中统一修改 */
  temperature?: number;
};

/** 提取 content 字段的兼容逻辑 */
function extractContent(raw: any): string {
  // OpenAI/Groq 兼容路径
  const c1 = raw?.choices?.[0]?.message?.content;
  if (typeof c1 === "string") return c1;

  // 某些 SDK 可能给 output_text / content
  const c2 = raw?.output_text || raw?.content;
  if (typeof c2 === "string") return c2;

  // 兜底：若原文本身就是字符串
  if (typeof raw === "string") return raw;

  return "";
}

/** 统一固定结构化输出（JSON object）、收敛采样参数，并返回完整 trace */
export async function groqChat(
  messages: ChatMsg[],
  opts: ChatOpts = {}
): Promise<{ text: string; trace: GroqTrace }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("[NDJC:groq] Missing GROQ_API_KEY");
  }

  const url =
    process.env.GROQ_BASE_URL ||
    "https://api.groq.com/openai/v1/chat/completions";

  const model =
    process.env.GROQ_MODEL || "llama-3.1-70b-versatile";

  // 固定结构化输出 + 采样参数收敛（如需调整，只改这里）
  const body = {
    model,
    messages,
    temperature: 0 as const,
    top_p: 1 as const,
    max_tokens: Number(process.env.NDJC_GROQ_MAX_TOKENS || 2048),
    response_format: { type: "json_object" as const },
    stream: false as const,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  // HTTP 非 2xx：直接抛错（同时把文本读出来便于日志）
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const e = new Error(
      `[NDJC:groq] HTTP ${res.status} ${res.statusText} ${errText ? `- ${errText.slice(0, 500)}` : ""}`
    );
    (e as any).status = res.status;
    (e as any).statusText = res.statusText;
    (e as any).responseText = errText;
    throw e;
  }

  // JSON 解析失败时也记录原文，减少黑盒
  const raw = await res
    .json()
    .catch(async () => ({ text: await res.text() }));

  const text = extractContent(raw);

  return {
    text,
    trace: {
      provider: "groq",
      url,
      model,
      request: body,
      response: raw,
      text,
      finish_reason: raw?.choices?.[0]?.finish_reason,
      usage: raw?.usage,
    },
  };
}
