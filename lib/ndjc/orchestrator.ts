// lib/ndjc/orchestrator.ts
// 作用：编排（提示词+registry→生成 Contract v1 原文 raw），解析、归一化，并返回 trace。
// 关键修正：
// 1) 在线失败/无 Key/拿到空文本 → 必回退 offline，保证返回里 raw 一定非空；trace.fallback=true。
// 2) trace 字段对齐：原文统一记录到 trace.raw_llm_text / trace.retry_raw_llm_text，便于 route.ts 读取。
// 3) 读取 retry 提示词不再使用 ?raw（在 Vercel/Next 上不稳定）；改为 fs 读取。
// 4) system 内容一律字符串（对 JSON 提示词 JSON.stringify）。

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { callGroqChat, ChatMessage } from "@/lib/ndjc/groq"; // 你现有的 groq 封装
// 离线生成器（你项目里已有）；如果路径不同，请对应调整
import { generateOfflineContractV1 } from "@/lib/ndjc/orchestrate/offline"; 

// 严格 JSON 解析与校验（仅在需要时由 route 调用，这里保留类型）
import { NdjcContractV1 } from "@/lib/ndjc/types"; 

type OrchestrateInput = {
  runId: string;
  nl: string;
  preset_hint?: string;
  template_key: string; // e.g. "circle-basic"
  mode?: "A" | "B";
  allowCompanions?: boolean;
};

type OrchestrateOk = {
  ok: true;
  raw: string;                 // NOTE: 保持字段名为 raw（route.ts 会兼容读取）
  parsed?: NdjcContractV1;     // 可选：如果你在编排器里就做了 parse（通常交给 route）
  plan?: any;                  // 可选：contract→plan（通常交给 route）
  trace: any;                  // meta._trace 等
};

type OrchestrateErr = {
  ok: false;
  reason: Array<{ code: string; message: string; path?: string }>;
  trace: any;
};

export type OrchestrateResult = OrchestrateOk | OrchestrateErr;

/** 小工具：计算文件短 hash（便于日志核对） */
async function fileSha256Short(filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(filePath);
    const h = crypto.createHash("sha256").update(buf).digest("hex");
    return h.slice(0, 12);
  } catch {
    return "unreadable";
  }
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const { runId, nl, preset_hint = "", template_key = "circle-basic", mode = "B" } = input;

  // 1) 解析提示词与 registry 的路径（按你项目的既有结构）
  const promptFile = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.en.json");
  const retryFile  = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.retry.en.txt"); // NOTE: 不再使用 ?raw
  const registryFile = path.join(process.cwd(), "lib/ndjc/anchors/registry.circle-basic.json");

  // 2) 读取内容并准备 trace
  const trace: any = {
    runId,
    template_key,
    preset_hint,
    mode,
    provider: process.env.LLM_PROVIDER || "unset",
    meta: {
      prompt_file: promptFile,
      prompt_sha: await fileSha256Short(promptFile),
      retry_file: retryFile,
      retry_sha: await fileSha256Short(retryFile),
      registry_file: registryFile,
      registry_sha: await fileSha256Short(registryFile),
    },
  };

  let systemPromptObj: any = {};
  try {
    const promptText = await fs.readFile(promptFile, "utf8");
    systemPromptObj = JSON.parse(promptText);
  } catch (e: any) {
    trace.error_prompt_read = String(e?.message || e);
  }

  let retryText = "";
  try {
    retryText = await fs.readFile(retryFile, "utf8");     // NOTE: 改为 fs 读取，避免 ?raw
  } catch (e: any) {
    trace.error_retry_read = String(e?.message || e);
  }

  // 3) 组装 messages（所有 content 必须是 string）
  const messagesFirst: ChatMessage[] = [
    { role: "system", content: JSON.stringify(systemPromptObj) },   // NOTE: system 一律字符串
    { role: "user", content: JSON.stringify({
        nl, preset_hint, template_key, runId,
        registry_info: { file: path.basename(registryFile), sha: trace.meta.registry_sha }
      })
    },
  ];

  // 4) 先尝试在线（groq），失败则回退离线
  const tryOnline = Boolean(process.env.GROQ_API_KEY) && (process.env.LLM_PROVIDER || "groq") !== "offline";

  let rawFirst = "";
  if (tryOnline) {
    try {
      rawFirst = (await callGroqChat({
        model: process.env.LLM_MODEL || "llama-3.1-70b-versatile",
        messages: messagesFirst,
        max_tokens: 2048,
        temperature: 0,
      }))?.trim() || "";
      trace.provider_used = "groq";
      trace.raw_llm_text = rawFirst; // NOTE: 对齐 trace 字段，route 可读取
    } catch (e: any) {
      trace.error_online = String(e?.message || e);
    }
  }

  // 5) 如果首次为空，带 retry 提示词再试一次在线
  if (!rawFirst?.trim() && tryOnline && retryText?.trim()) {
    const messagesRetry: ChatMessage[] = [
      { role: "system", content: JSON.stringify(systemPromptObj) },
      { role: "user", content: JSON.stringify({
          nl, preset_hint, template_key, runId,
          registry_info: { file: path.basename(registryFile), sha: trace.meta.registry_sha }
        })
      },
      { role: "system", content: retryText },
    ];
    try {
      rawFirst = (await callGroqChat({
        model: process.env.LLM_MODEL || "llama-3.1-70b-versatile",
        messages: messagesRetry,
        max_tokens: 2048,
        temperature: 0,
      }))?.trim() || "";
      trace.retry_raw_llm_text = rawFirst; // NOTE: route 也会读取这个字段
      trace.provider_used = "groq";
    } catch (e: any) {
      trace.error_online_retry = String(e?.message || e);
    }
  }

  // 6) 在线仍然拿不到 → 必走离线 fallback，保证 raw 非空
  if (!rawFirst?.trim()) {
    try {
      const offline = await generateOfflineContractV1({
        nl, preset_hint, template_key, runId,
      });
      rawFirst = typeof offline === "string" ? offline.trim() : JSON.stringify(offline ?? {});
      trace.provider_used = "offline";
      trace.fallback = true;
      trace.raw_llm_text = rawFirst;
    } catch (e: any) {
      // 离线也失败 → 只能返回结构化错误，但附带 trace 用于定位
      return {
        ok: false,
        reason: [{ code: "E_NO_TEXT", message: "No raw contract text generated (online & offline failed)" }],
        trace,
      };
    }
  }

  // 7) 返回（不在这里强解析；让 route.ts 再做 parse/validate/plan）
  return {
    ok: true,
    raw: rawFirst,  // NOTE: 保持为 raw；route.ts 会兼容读取
    trace,
  };
}
