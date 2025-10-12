// lib/ndjc/orchestrator.ts
// - 仅从文件读取 system / retry 提示词（无内置提示词文本）
// - 对每次 LLM 尝试都落盘原文：requests/<runId>/00_llm_raw.attempt{N}.txt 和 00_llm_raw.txt
// - 成功解析后写 01_contract.json，并在 meta._trace 中固化：prompt/retry/registry 路径+sha1、model、attempts、raw_path、raw_len、timestamp、errors
// - 失败时直接抛错（不兜底），但会保留 00_llm_raw*.txt，便于预检(contract-precheck)与排查

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type OrchestrateParams = {
  runId: string;
  requirement: string;
  outDir?: string;

  // 可覆盖默认文件路径（也可用环境变量）
  promptSystemFile?: string; // 默认 lib/ndjc/prompts/contract_v1.en.json
  promptRetryFile?: string;  // 默认 lib/ndjc/prompts/contract_v1.retry.en.txt
  registryFile?: string;     // 默认 lib/ndjc/anchors/registry.circle-basic.json

  // LLM
  model?: string;
  maxRetry?: number;
  temperature?: number;
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
  raw_path?: string; // 最后一次尝试的原文路径
  raw_len?: number;  // 原文长度（字符）
};

export type OrchestrateOutput = {
  run_id: string;
  ok: true;
  contract_path: string;
  model: string;
  meta: { trace: MetaTrace };
};

// ------- 默认配置（仅路径与数值；不含任何提示词文本） -------
const DEFAULT_SYSTEM_FILE =
  process.env.NDJC_PROMPT_SYSTEM_FILE || "lib/ndjc/prompts/contract_v1.en.json";
const DEFAULT_RETRY_FILE =
  process.env.NDJC_PROMPT_RETRY_FILE || "lib/ndjc/prompts/contract_v1.retry.en.txt";
const DEFAULT_REGISTRY_FILE =
  process.env.NDJC_REGISTRY_FILE || "lib/ndjc/anchors/registry.circle-basic.json";

const DEFAULT_MODEL = process.env.NDJC_LLM_MODEL || "gpt-4o-mini";
const DEFAULT_MAX_RETRY = Number(process.env.NDJC_LLM_MAX_RETRY || 2);
const DEFAULT_TEMPERATURE = Number(process.env.NDJC_LLM_TEMPERATURE || 0);

// -------------------- helpers --------------------
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readFileMaybe(filePath?: string): Promise<{
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

async function readJsonMaybe<T = any>(filePath?: string): Promise<{
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

function extractJsonObject(text: string): any | null {
  if (!text) return null;
  // 支持 ```json ... ``` 包裹或纯文本 JSON
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

async function writeText(filePath: string, text: string) {
  await fs.writeFile(filePath, text ?? "", "utf-8");
}

// -------------------- main --------------------
export async function orchestrate(params: OrchestrateParams): Promise<OrchestrateOutput> {
  const {
    runId,
    requirement,
    outDir = "requests",
    promptSystemFile,
    promptRetryFile,
    registryFile,
    model = DEFAULT_MODEL,
    maxRetry = DEFAULT_MAX_RETRY,
    temperature = DEFAULT_TEMPERATURE,
  } = params;

  const reqDir = path.join(outDir, String(runId));
  await ensureDir(reqDir);

  // 加载注册表与提示词（仅从文件）
  const [
    { ok: regOk, absPath: regPath, sha1: regSha1, err: regErr },
    sys,
    rty,
  ] = await Promise.all([
    readJsonMaybe<any>(registryFile || DEFAULT_REGISTRY_FILE),
    readFileMaybe(promptSystemFile || DEFAULT_SYSTEM_FILE),
    readFileMaybe(promptRetryFile || DEFAULT_RETRY_FILE),
  ]);

  console.log("[orchestrator] sources", {
    registry: { ok: regOk, file: regPath },
    system: { ok: sys.ok, file: sys.absPath },
    retry: { ok: rty.ok, file: rty.absPath },
  });

  const metaTrace: MetaTrace = {
    prompt_file: sys.absPath,
    prompt_sha1: sys.sha1,
    retry_file: rty.absPath,
    retry_sha1: rty.sha1,
    registry_file: regPath,
    registry_sha1: regSha1,
    model,
    attempts: 0,
    timestamp: new Date().toISOString(),
    errors: [
      ...(sys.ok ? [] : [`system_prompt:${sys.err}`]),
      ...(rty.ok ? [] : [`retry_prompt:${rty.err}`]),
      ...(regOk ? [] : [`registry:${regErr}`]),
    ],
  };

  // 组织基础消息
  const baseMsgs: ChatMsg[] = [];
  if (sys.ok && sys.text) baseMsgs.push({ role: "system", content: sys.text });
  baseMsgs.push({ role: "user", content: requirement || "" });

  // 调 LLM：每次尝试都把原文落盘
  let contractObj: any | null = null;
  let lastErr: any = null;
  let lastRawPath: string | undefined;
  let lastRawLen = 0;

  const tries = Math.max(1, maxRetry);
  for (let attempt = 1; attempt <= tries; attempt++) {
    metaTrace.attempts = attempt;
    let messages = baseMsgs;
    if (attempt > 1 && rty.ok && rty.text) {
      messages = [{ role: "system", content: rty.text }, ...baseMsgs];
    }

    try {
      console.log("[orchestrator] callGroqChat.start", { attempt, withSystem: !!sys.text, withRetrySystem: attempt > 1 && !!rty.text });
      const r = await callGroqChat(messages, { json: true, temperature });
      const raw = typeof r === "string" ? r : (r as any)?.text ?? "";

      // 1) 总是落盘原文（按尝试号 & 最新别名）
      const rawAttempt = path.join(reqDir, `00_llm_raw.attempt${attempt}.txt`);
      await writeText(rawAttempt, raw);
      const rawLatest = path.join(reqDir, "00_llm_raw.txt");
      await writeText(rawLatest, raw);

      lastRawPath = rawLatest;
      lastRawLen = raw.length;

      console.log("[orchestrator] callGroqChat.done", { attempt, rawLen: raw.length });

      // 2) 尝试解析 JSON
      const parsed = extractJsonObject(raw);
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
    // 不兜底：直接失败，但保留 raw 文件
    metaTrace.raw_path = lastRawPath;
    metaTrace.raw_len = lastRawLen;
    metaTrace.errors.push(`llm_failed:${lastErr?.message || String(lastErr) || "unknown"}`);

    // 将 metaTrace 也落一份，方便排查
    const tracePath = path.join(reqDir, "00_trace.json");
    await fs.writeFile(tracePath, JSON.stringify({ meta: { _trace: metaTrace } }, null, 2), "utf-8");

    throw new Error(`orchestrate_failed: ${lastErr?.message || "no_valid_json"}`);
  }

  // 成功：写入 01_contract.json + meta._trace（含 raw 信息）
  metaTrace.raw_path = lastRawPath;
  metaTrace.raw_len = lastRawLen;

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
