// lib/ndjc/orchestrator.ts
import { callGroqChat, ChatMessage } from "@/lib/ndjc/groq";
import systemContract from "@/lib/ndjc/prompts/contract_v1.en.json"; // 作为 System Prompt
import retryText from "@/lib/ndjc/prompts/contract_v1.retry.en.txt?raw"; // 作为文字模板（Vite/Next 可直接导入 txt；若不支持请改为 fs 读取）

type AnyRecord = Record<string, any>;

function parseJSONSafe(text: string): { ok: true; data: AnyRecord } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

function buildMessages(nl: string): ChatMessage[] {
  const sys = [
    "You are NDJC’s Contract generator for building a native Android APK.",
    "Return STRICT JSON only with this single top-level object:",
    '`{"anchorsGrouped": {"text": {...}, "block": {...}, "list": {...}, "if": {...}, "hook": {...}, "gradle": {...}}}`',
    "Follow the schema and constraints below.",
    "",
    JSON.stringify(systemContract, null, 2),
  ].join("\n");

  return [
    { role: "system", content: sys },
    {
      role: "user",
      content:
        [
          "# BUILD GOAL",
          "We are building a native Android APK from the user's requirement below.",
          "Every anchor in the whitelist MUST be filled with a build-usable value (no placeholder/empty/default markers).",
          "",
          "# Requirement (natural language)",
          nl,
        ].join("\n"),
    },
  ];
}

function buildRetryMessages(rawFirst: string, issues: string): ChatMessage[] {
  const content = `${retryText}`.replace("{ISSUES}", issues || "the invalid or missing fields");
  return [
    { role: "assistant", content: rawFirst },
    { role: "user", content },
  ];
}

function extractIssuesFrom(text: string): string {
  // 简单提取：把 JSON.parse 的错误消息带回去；如果首轮是非 JSON，告诉模型“必须返回严格 JSON”
  const err = parseJSONSafe(text);
  if ("ok" in err && !err.ok) {
    return `Your last reply was not valid JSON. Parser error: ${err.error}. You MUST return strictly one JSON object as described by the schema.`;
  }
  return "Returned object did not match schema. Fill all anchors with build-usable values.";
}

export interface OrchestrateInput {
  nl: string;                   // 用户自然语言需求
  preset?: string;              // 例如 "social"
  templateKey?: string;         // 例如 "circle-basic"
  mode?: "A" | "B";             // 你的业务模式
}

export interface OrchestrateResult {
  ok: boolean;
  parsed?: AnyRecord;
  raw?: string;
  reason?: { code: string; message: string; path?: string }[];
  trace: {
    raw_llm_text: string;
    retry_raw_llm_text?: string;
    prompt_sha256?: string;
  };
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const nl = (input?.nl || "").trim();
  const trace: OrchestrateResult["trace"] = { raw_llm_text: "" };

  if (!nl) {
    return {
      ok: false,
      reason: [{ code: "E_NL_EMPTY", message: "Natural language requirement is empty" }],
      trace,
    };
  }

  // 1) 首轮请求
  const firstMsgs = buildMessages(nl);
  const firstRaw = await callGroqChat(firstMsgs, {
    temperature: 0,
    top_p: 1,
    max_tokens: 2048,
  });

  trace.raw_llm_text = firstRaw ?? "";

  // 2) 解析
  const firstParsed = parseJSONSafe(firstRaw);
  if (firstParsed.ok) {
    return { ok: true, parsed: firstParsed.data, raw: firstRaw, trace };
  }

  // 3) 一次重试（精确说明问题）
  const issues = extractIssuesFrom(firstRaw);
  const retryMsgs = buildRetryMessages(firstRaw, issues);
  const retryRaw = await callGroqChat(retryMsgs, {
    temperature: 0,
    top_p: 1,
    max_tokens: 2048,
  });
  trace.retry_raw_llm_text = retryRaw ?? "";

  const retryParsed = parseJSONSafe(retryRaw);
  if (retryParsed.ok) {
    return { ok: true, parsed: retryParsed.data, raw: retryRaw, trace };
  }

  // 4) 还是失败 → 把两个原文都提供给上游，避免 “No raw LLM text to validate”
  return {
    ok: false,
    reason: [
      {
        code: "E_NOT_JSON",
        message:
          "Both first and retry replies are not valid strict JSON. See trace.raw_llm_text / trace.retry_raw_llm_text.",
        path: "<root>",
      },
    ],
    trace,
  };
}
