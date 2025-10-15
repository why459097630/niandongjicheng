// lib/ndjc/orchestrator.ts
// 编排器（最小改动修正版）
// - System Prompt 用 JSON（import），Retry 提示词用 .txt（fs 读取）
// - Groq 失败/无 Key/空返回 → 必走 offline 占位，保证 raw 非空
// - trace 字段规范：raw_llm_text / retry_raw_llm_text / provider_used / fallback / error_*
// - 返回 { ok, raw, trace }，保持与现有 route.ts 的调用契约

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import systemContract from "@/lib/ndjc/prompts/contract_v1.en.json"; // 作为 System Prompt（对象）
import { callGroqChat, ChatMessage } from "@/lib/ndjc/groq";

type AnyRecord = Record<string, any>;

type OrchestrateInput = {
  runId: string;
  nl: string;
  preset_hint?: string;
  template_key: string; // e.g. circle-basic
  mode?: "A" | "B";
  allowCompanions?: boolean;
};

type OrchestrateOk = {
  ok: true;
  raw: string;     // NOTE: 保持为 raw，方便与你的 route.ts 兼容
  trace: AnyRecord;
};

type OrchestrateErr = {
  ok: false;
  reason: Array<{ code: string; message: string; path?: string }>;
  trace: AnyRecord;
};

export type OrchestrateResult = OrchestrateOk | OrchestrateErr;

/** 计算短 sha，方便在 meta 里观测 */
async function fileSha256Short(filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);
    const h = crypto.createHash("sha256").update(buf).digest("hex");
    return h.slice(0, 12);
  } catch {
    return "unreadable";
  }
}

/** 最小离线占位：保证永不返回空 raw（可后续替换为你的正式 offline 逻辑） */
async function generateOfflineContractV1(input: {
  runId: string;
  nl: string;
  preset_hint?: string;
  template_key: string;
}) {
  const payload = {
    contract: "v1",
    meta: {
      provider: "offline",
      runId: input.runId,
      template_key: input.template_key,
      preset_hint: input.preset_hint ?? "",
    },
    anchorsGrouped: {
      text: {
        APP_LABEL: "__NDJC_APP__",
        PACKAGE_NAME: "com.ndjc.app", // 可编译占位，路由层/清洗可再改
      },
      block: {},
      list: {},
      if: {},
      hook: {},
      gradle: {},
    },
  };
  return JSON.stringify(payload);
}

function toMessages(args: {
  systemPromptObj: AnyRecord;
  nl: string;
  preset_hint: string;
  template_key: string;
  runId: string;
  registrySha?: string;
  retryText?: string;
}): ChatMessage[] {
  const { systemPromptObj, nl, preset_hint, template_key, runId, registrySha, retryText } = args;

  const sys = [
    "You are a contract generator. Return STRICT JSON ONLY. No prose.",
    "",
    "Return STRICT JSON only with this single top-level object:",
    '`{"anchorsGrouped": {"text": {...}, "block": {...}, "list": {...}, "if": {...}, "hook": {...}, "gradle": {...}}}`',
    "Follow the schema and constraints below.",
    "",
    JSON.stringify(systemPromptObj, null, 2), // NOTE: system 必须是字符串
  ].join("\n");

  const user = [
    "# BUILD GOAL",
    "We are building a native Android APK via a template system with strictly whitelisted anchors.",
    "",
    "# INPUT",
    JSON.stringify({ nl, preset_hint, template_key, runId, registry_sha: registrySha ?? "" }, null, 2),
    "",
    "# RULES",
    "- ONLY return strict JSON. No additional keys. No angle brackets. No empty strings/arrays.",
    "- Prefer placeholders that compile if unsure (e.g., __NDJC_PLACEHOLDER__).",
    "- Package name must be valid (e.g., com.example.app).",
  ].join("\n");

  const msgs: ChatMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];

  if (retryText && retryText.trim()) {
    // 第二次重试时，把 retry 文字按原样塞进 system（或 user），保持字符串
    msgs.push({ role: "system", content: retryText });
  }

  return msgs;
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const { runId, nl, preset_hint = "", template_key, mode = "B" } = input;

  // 约定文件路径（按你项目结构）
  const promptFile = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.en.json");
  const retryFile = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.retry.en.txt"); // NOTE: 继续用 .txt
  const registryFile = path.join(process.cwd(), "lib/ndjc/anchors/registry.circle-basic.json");

  const trace: AnyRecord = {
    runId,
    template_key,
    preset_hint,
    mode,
    provider: process.env.LLM_PROVIDER || "groq",
    meta: {
      prompt_file: promptFile,
      prompt_sha: await fileSha256Short(promptFile),
      retry_file: retryFile,
      retry_sha: await fileSha256Short(retryFile),
      registry_file: registryFile,
      registry_sha: await fileSha256Short(registryFile),
    },
  };

  // 读取 retry 文本（不再用 ?raw）
  let retryText = "";
  try {
    retryText = await fs.readFile(retryFile, "utf8");
  } catch (e: any) {
    trace.error_retry_read = String(e?.message || e);
  }

  // 组装第一次调用的 messages
  const messagesFirst = toMessages({
    systemPromptObj: systemContract,         // NOTE: 对象在 toMessages 里 stringify
    nl,
    preset_hint,
    template_key,
    runId,
    registrySha: trace.meta.registry_sha,
  });

  const tryOnline = Boolean(process.env.GROQ_API_KEY) && (process.env.LLM_PROVIDER ?? "groq") !== "offline";
  let raw = "";
  let usedRetry = false;

  if (tryOnline) {
    try {
      raw = (await callGroqChat({
        model: process.env.LLM_MODEL || "llama-3.1-70b-versatile",
        messages: messagesFirst,
        max_tokens: 2048,
        temperature: 0,
        stream: false,
      }))?.trim() || "";
      trace.provider_used = "groq";
      trace.raw_llm_text = raw;
    } catch (e: any) {
      trace.error_online = String(e?.message || e);
    }
  }

  // 首次为空 → 尝试带 retry 文本再调一次
  if (!raw?.trim() && tryOnline && retryText?.trim()) {
    usedRetry = true;
    try {
      const messagesRetry = toMessages({
        systemPromptObj: systemContract,
        nl,
        preset_hint,
        template_key,
        runId,
        registrySha: trace.meta.registry_sha,
        retryText,
      });
      raw = (await callGroqChat({
        model: process.env.LLM_MODEL || "llama-3.1-70b-versatile",
        messages: messagesRetry,
        max_tokens: 2048,
        temperature: 0,
        stream: false,
      }))?.trim() || "";
      trace.provider_used = "groq";
      trace.retry_raw_llm_text = raw;
    } catch (e: any) {
      trace.error_online_retry = String(e?.message || e);
    }
  }

  // 在线仍然没有拿到文本 → 必走离线占位，保证 raw 非空
  if (!raw?.trim()) {
    try {
      raw = await generateOfflineContractV1({ runId, nl, preset_hint, template_key });
      trace.provider_used = "offline";
      trace.fallback = true;
      // 对齐下字段，方便路由侧读取
      if (usedRetry) {
        trace.retry_raw_llm_text = raw;
      } else {
        trace.raw_llm_text = raw;
      }
    } catch (e: any) {
      return {
        ok: false,
        reason: [{ code: "E_NO_TEXT", message: "No raw LLM text (online & offline both failed)" }],
        trace,
      };
    }
  }

  // 返回成功；严格解析/校验/落盘交给 route.ts 后续步骤
  return {
    ok: true,
    raw,
    trace,
  };
}
