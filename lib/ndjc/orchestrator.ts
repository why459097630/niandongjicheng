// lib/ndjc/orchestrator.ts
// - 仅从文件读取 system / retry 提示词（不再内置任何提示词文本）
// - 写入 requests/<RUN_ID>/01_contract.json，并在其中附带 meta._trace
// - LLM 失败或解析失败时，走 offlineContract 兜底生成最小可用契约

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { NdjcRequest } from "./types";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";      // 你项目现有的 LLM 适配
import { offlineContract } from "@/lib/ndjc/offline";            // 你项目现有的离线兜底

/* ======================== types ======================== */

type Registry = {
  template: string;
  schemaVersion?: string;

  text: string[];
  block: string[];
  list: string[];
  if: string[];
  hook: string[];
  resources?: string[];

  aliases?: Record<string, string>;
  required?: {
    text?: string[];
    block?: string[];
    list?: string[];
    if?: string[];
    hook?: string[];
    gradle?: string[];
  };
  defaults?: {
    text?: Record<string, string>;
    list?: Record<string, string[]>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };
  valueRules?: {
    text?: Record<string, { type: "string"; placeholder?: string }>;
    block?: Record<string, { type: "string"; placeholder?: string }>;
    list?: Record<string, { type: "string[]"; placeholder?: string[] }>;
    if?: Record<string, { type: "boolean"; placeholder?: boolean }>;
    hook?: Record<string, { type: "string"; placeholder?: string }>;
  };
};

export type OrchestrateInput = NdjcRequest & {
  /** 自然语言需求（通常由前端传入） */
  requirement?: string;

  /** 运行模式（保持你现有字段，便于兼容） */
  mode?: "A" | "B";
  allowCompanions?: boolean;

  /** 透传给 LLM/契约的可选字段（不强制） */
  appName?: string;
  homeTitle?: string;
  mainButtonText?: string;
  packageId?: string;
  packageName?: string;

  permissions?: string[];
  intentHost?: string | null;
  locales?: string[];
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;

  developerNotes?: string;

  contract?: "v1" | "legacy";
  contractV1?: boolean;

  // 覆盖提示词/注册表文件（可用 env 替代）
  promptSystemFile?: string;
  promptRetryFile?: string;
  registryFile?: string;

  // LLM 配置
  model?: string;
  maxRetry?: number;
  temperature?: number;
};

export type OrchestrateOutput = {
  run_id: string;
  ok: boolean;
  contract_path: string;
  model: string;
  meta: {
    trace: MetaTrace;
  };
};

type MetaTrace = {
  prompt_file?: string;
  prompt_sha1?: string;
  retry_file?: string;
  retry_sha1?: string;
  registry_file?: string;
  registry_sha1?: string;
  model: string;
  attempts: number;
  timestamp: string;
  errors: string[];
  // 需要的话可以追加更多字段（如耗时、token 用量等）
};

/* ======================== helpers ======================== */

function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const m =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/) ||
    null;
  const raw = m ? m[1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readFileMaybe(filePath: string | undefined): Promise<{
  ok: boolean; absPath?: string; text?: string; sha1?: string; err?: string;
}> {
  if (!filePath) return { ok: false, err: "empty_path" };
  try {
    const abs = path.resolve(filePath);
    const buf = await fs.readFile(abs);
    const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
    return { ok: true, absPath: abs, text: buf.toString("utf-8"), sha1 };
  } catch (e: any) {
    return { ok: false, err: `read_failed:${e?.message || String(e)}` };
  }
}

async function readJsonMaybe<T = any>(filePath: string | undefined): Promise<{
  ok: boolean; absPath?: string; data?: T; sha1?: string; err?: string;
}> {
  const r = await readFileMaybe(filePath);
  if (!r.ok) return { ok: false, err: r.err };
  try {
    const data = JSON.parse(r.text!);
    return { ok: true, absPath: r.absPath, data, sha1: r.sha1 };
  } catch (e: any) {
    return { ok: false, absPath: r.absPath, sha1: r.sha1, err: `json_parse_failed:${e?.message || String(e)}` };
  }
}

async function loadRegistry(override?: string): Promise<{
  reg: Registry | null; file?: string; sha1?: string; err?: string;
}> {
  const cwd = process.cwd();
  const hint =
    override ||
    process.env.REGISTRY_FILE ||
    process.env.NDJC_REGISTRY_FILE ||
    path.join(cwd, "lib/ndjc/anchors/registry.circle-basic.json");

  const r = await readJsonMaybe<Registry>(hint);
  if (r.ok && r.data) {
    console.log("[orchestrator] registry loaded:", { file: r.absPath, template: r.data.template, schemaVersion: r.data.schemaVersion });
    return { reg: r.data, file: r.absPath, sha1: r.sha1 };
  }
  console.log("[orchestrator] registry load failed, fallback minimal:", r.err);
  return { reg: null, file: r.absPath, sha1: r.sha1, err: r.err };
}

async function loadPromptsFromFiles(systemOverride?: string, retryOverride?: string) {
  const cwd = process.cwd();
  const systemFile =
    systemOverride ||
    process.env.NDJC_PROMPT_SYSTEM_FILE ||
    path.join(cwd, "lib/ndjc/prompts/contract_v1.en.json");
  const retryFile =
    retryOverride ||
    process.env.NDJC_PROMPT_RETRY_FILE ||
    path.join(cwd, "lib/ndjc/prompts/contract_v1.retry.en.txt");

  const sys = await readFileMaybe(systemFile);
  const rty = await readFileMaybe(retryFile);

  // 仅记录来源；**不内置任何提示词文本**（文件读不到就没有）
  console.log("[orchestrator] prompt sources:", {
    systemFile,
    systemRead: !!sys.text,
    retryFile,
    retryRead: !!rty.text,
  });

  return {
    systemText: sys.ok ? (sys.text || "") : "",
    systemFile: sys.absPath,
    systemSha1: sys.sha1,
    retryText: rty.ok ? (rty.text || "") : "",
    retryFile: rty.absPath,
    retrySha1: rty.sha1,
    errors: [
      ...(sys.ok ? [] : [`system_prompt:${sys.err}`]),
      ...(rty.ok ? [] : [`retry_prompt:${rty.err}`]),
    ],
  };
}

/* ======================== main ======================== */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const {
    runId,
    requirement = "",
    outDir = "requests",       // NdjcRequest 里通常含有 outDir/runId 等，沿用你的项目结构
    promptSystemFile,
    promptRetryFile,
    registryFile,
    model = process.env.NDJC_LLM_MODEL || "gpt-4o-mini",
    maxRetry = Number(process.env.NDJC_LLM_MAX_RETRY || 2),
    temperature = Number(process.env.NDJC_LLM_TEMPERATURE || 0),
  } = input as any;

  const reqDir = path.join(outDir || "requests", String(runId));
  await ensureDir(reqDir);

  // 1) 加载注册表 + 提示词（仅从文件）
  const [{ reg, file: regFile, sha1: regSha1, err: regErr }, prompts] = await Promise.all([
    loadRegistry(registryFile),
    loadPromptsFromFiles(promptSystemFile, promptRetryFile),
  ]);

  // 2) 组装 meta.trace
  const metaTrace: MetaTrace = {
    prompt_file: prompts.systemFile,
    prompt_sha1: prompts.systemSha1,
    retry_file: prompts.retryFile,
    retry_sha1: prompts.retrySha1,
    registry_file: regFile,
    registry_sha1: regSha1,
    model,
    attempts: 0,
    timestamp: new Date().toISOString(),
    errors: [...prompts.errors, ...(regErr ? [`registry:${regErr}`] : [])],
  };

  // 3) 准备消息（仅当“文件中读到了内容”才加入 system / retry）
  const baseUser = requirement || (input as any).input || "";
  const baseMsgs: any[] = [];
  if (prompts.systemText) baseMsgs.push({ role: "system", content: prompts.systemText });
  baseMsgs.push({ role: "user", content: baseUser });

  // 4) 调 LLM：生成契约（失败则兜底）
  let contractObj: any | null = null;
  let lastErr: any = null;
  const tries = Math.max(1, maxRetry);

  for (let attempt = 1; attempt <= tries; attempt++) {
    metaTrace.attempts = attempt;

    let msgs = baseMsgs;
    if (attempt > 1 && prompts.retryText) {
      // 仅当存在 retry 提示词文件时，重试才追加一条 system
      msgs = [{ role: "system", content: prompts.retryText }, ...baseMsgs];
    }

    try {
      console.log("[orchestrator] callGroqChat.start", { attempt, withSystem: !!prompts.systemText, withRetrySystem: attempt > 1 && !!prompts.retryText });
      const r = await callGroqChat(msgs, { json: true, temperature });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      console.log("[orchestrator] callGroqChat.done", { attempt, textLen: text.length });

      const parsed = parseJsonSafely(text);
      if (parsed && typeof parsed === "object") {
        contractObj = parsed;
        break;
      }
      lastErr = new Error("extract_json_failed");
    } catch (e: any) {
      lastErr = e;
      console.log("[orchestrator] callGroqChat.error", { attempt, error: e?.message || String(e) });
    }
  }

  if (!contractObj) {
    // 5) 兜底：基于注册表最小化生成
    metaTrace.errors.push(`llm_failed:${lastErr?.message || String(lastErr) || "unknown"}`);
    const registryData = reg || {};
    contractObj = await offlineContract({ userInput: baseUser, registry: registryData });
  }

  // 6) 写入 01_contract.json，并附带 meta._trace
  if (!contractObj.meta) contractObj.meta = {};
  contractObj.meta._trace = metaTrace;

  const out01 = path.join(reqDir, "01_contract.json");
  await fs.writeFile(out01, JSON.stringify(contractObj, null, 2), "utf-8");

  return {
    run_id: String(runId),
    ok: true,
    contract_path: out01,
    model,
    meta: { trace: metaTrace },
  };
}

export default orchestrate;
