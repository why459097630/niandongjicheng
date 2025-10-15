// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";

import { callGroqChat, ChatMessage } from "@/lib/ndjc/groq";
import systemContract from "@/lib/ndjc/prompts/contract_v1.en.json"; // 作为 System Prompt
// ❌ 删掉 ?raw 导入，构建期会失败
// import retryText from "@/lib/ndjc/prompts/contract_v1.retry.en.txt?raw";

type AnyRecord = Record<string, any>;

/* ----------------- 小工具 ----------------- */
function parseJSONSafe(text: string): { ok: true; data: AnyRecord } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Invalid JSON" };
  }
}

/** 若缺失则注入 metadata.template / metadata.mode */
function ensureMetadata(raw: string, templateKey?: string, mode?: "A" | "B") {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return raw;

    obj.metadata ??= {};
    const tpl = templateKey || "circle-basic";
    const m = mode || "B";

    if (typeof obj.metadata.template !== "string" || !obj.metadata.template.trim()) {
      obj.metadata.template = tpl;
    }
    if (obj.metadata.mode !== m) {
      obj.metadata.mode = m;
    }
    return JSON.stringify(obj);
  } catch {
    // 不是 JSON，就保持原样（上层会继续处理）
    return raw;
  }
}

/** 读取 retry 文本（Node 运行时） */
async function loadRetryText(): Promise<string> {
  const retryFile = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.retry.en.txt");
  try {
    return await fs.readFile(retryFile, "utf8");
  } catch {
    return ""; // 读不到就不用 retry 提示，也不要阻塞
  }
}

/* ----------------- Prompt 组装 ----------------- */
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
      content: [
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

function buildRetryMessages(rawFirst: string, issues: string, retryText: string): ChatMessage[] {
  const content = `${retryText || "Fix the following violations and RETURN STRICT JSON with the SAME KEYS:"}\n\n${issues || "{ISSUES}"}`;
  return [
    { role: "assistant", content: rawFirst },
    { role: "user", content },
  ];
}

function extractIssuesFrom(text: string): string {
  const err = parseJSONSafe(text);
  if ("ok" in err && !err.ok) {
    return `Your last reply was not valid JSON. Parser error: ${err.error}. You MUST return strictly one JSON object as described by the schema.`;
  }
  return "Returned object did not match schema. Fill all anchors with build-usable values.";
}

/* ----------------- 类型 ----------------- */
export interface OrchestrateInput {
  nl: string;                   // 用户自然语言需求
  preset?: string;              // 例如 "social"（未使用，保留兼容）
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
    fallback?: "offline";
  };
}

/* ----------------- 主流程 ----------------- */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const nl = (input?.nl || "").trim();
  const templateKey = input?.templateKey || "circle-basic";
  const mode = input?.mode || "B";

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
    // 注入/覆盖 metadata.template & metadata.mode
    const fixedRaw = ensureMetadata(firstRaw!, templateKey, mode);
    const fixedParsed = parseJSONSafe(fixedRaw);
    return { ok: true, parsed: fixedParsed.ok ? fixedParsed.data : undefined, raw: fixedRaw, trace };
  }

  // 3) 一次重试（精确说明问题）
  const retryText = await loadRetryText();
  const issues = extractIssuesFrom(firstRaw || "");
  const retryMsgs = buildRetryMessages(firstRaw || "", issues, retryText);
  const retryRaw = await callGroqChat(retryMsgs, {
    temperature: 0,
    top_p: 1,
    max_tokens: 2048,
  });
  trace.retry_raw_llm_text = retryRaw ?? "";

  const retryParsed = parseJSONSafe(retryRaw);
  if (retryParsed.ok) {
    const fixedRaw = ensureMetadata(retryRaw!, templateKey, mode);
    const fixedParsed = parseJSONSafe(fixedRaw);
    return { ok: true, parsed: fixedParsed.ok ? fixedParsed.data : undefined, raw: fixedRaw, trace };
  }

  // 4) 还是失败 → 给上游一个最小“可编译占位”JSON，避免 "No raw LLM text to validate"
  const offlineObj = {
    contract: "v1",
    metadata: {
      template: templateKey,
      mode,
      ndjc: { provider: "offline" },
    },
    anchorsGrouped: {
      text: {
        "NDJC:APP_LABEL": "NDJC App",
        "NDJC:PACKAGE_NAME": "com.ndjc.app",
        "NDJC:HOME_TITLE": "Home",
        "NDJC:PRIMARY_BUTTON_TEXT": "Create",
        "NDJC:I18N_ENABLED": true,
        "NDJC:ANIM_ENABLED": true,
        "NDJC:ANIM_DURATION_MS": 300,
        "NDJC:PAGING_SIZE": 10,
        "NDJC:FEED_SORT": "date",
      },
      block: "",
      list: { ROUTES: ["home"] },
      if: "",
      hook: "",
      gradle: { applicationId: "com.ndjc.app", resConfigs: ["en"] },
      permissions: ["android.permission.INTERNET"],
    },
  };

  const offlineRaw = JSON.stringify(offlineObj);
  trace.fallback = "offline";

  return {
    ok: false, // 维持原逻辑：表示在线两次都没产出合格 JSON
    reason: [
      {
        code: "E_NOT_JSON",
        message:
          "Both first and retry replies are not valid strict JSON. A minimal offline JSON has been provided in .raw for validation/materialization.",
        path: "<root>",
      },
    ],
    raw: offlineRaw, // ✅ 关键：依然提供 raw，路由层可继续做严格解析/校验
    trace,
  };
}
