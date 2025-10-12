// lib/ndjc/orchestrator.ts
// - 仅从文件读取 system / retry 提示词（不内置任何提示词文本）
// - 成功时写入 requests/<RUN_ID>/01_contract.json，附带 meta._trace
// - 失败（读不到文件 / LLM 错 / 非 JSON）直接抛错 -> 构建失败
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
  promptSystemFile?: string;
  promptRetryFile?: string;
  registryFile?: string;

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
async function loadPrompts(systemOverride?: string, retryOverride?: string) {
  const systemFile =
    systemOverride || process.env.NDJC_PROMPT_SYSTEM_FILE || DEFAULT_SYSTEM_FILE;
  const retryFile =
    retryOverride || process.env.NDJC_PROMPT_RETRY_FILE || DEFAULT_RETRY_FILE;

  const sys = await readFileMaybe(systemFile);
  const rty = await readFileMaybe(retryFile);

  console.log("[orchestrator] prompt sources", {
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
async function loadRegistry(registryOverride?: string) {
  const file =
    registryOverride || process.env.NDJC_REGISTRY_FILE || DEFAULT_REGISTRY_FILE;
  const r = await readJsonMaybe<any>(file);
  if (!r.ok) {
    console.log("[orchestrator] registry load failed", r.err);
  } else {
    console.log("[orchestrator] registry loaded", { file: r.absPath });
  }
  return r;
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

  const [{ ok: regOk, absPath: regPath, sha1: regSha1, err: regErr }, prompts] =
    await Promise.all([loadRegistry(registryFile), loadPrompts(promptSystemFile, promptRetryFile)]);

  // 仅记录来源；不内置任何提示词文本
  const baseMsgs: ChatMsg[] = [];
  if (prompts.systemText) baseMsgs.push({ role: "system", content: prompts.systemText });
  baseMsgs.push({ role: "user", content: requirement || "" });

  const metaTrace: MetaTrace = {
    prompt_file: prompts.systemFile,
    prompt_sha1: prompts.systemSha1,
    retry_file: prompts.retryFile,
    retry_sha1: prompts.retrySha1,
    registry_file: regPath,
    registry_sha1: regSha1,
    model,
    attempts: 0,
    timestamp: new Date().toISOString(),
    errors: [...prompts.errors, ...(regErr ? [`registry:${regErr}`] : [])],
  };

  // LLM 调用（失败/非 JSON -> 抛错）
  let contractObj: any | null = null;
  let lastErr: any = null;
  const tries = Math.max(1, maxRetry);

  for (let attempt = 1; attempt <= tries; attempt++) {
    metaTrace.attempts = attempt;

    let messages = baseMsgs;
    if (attempt > 1 && prompts.retryText) {
      messages = [{ role: "system", content: prompts.retryText }, ...baseMsgs];
    }

    try {
      console.log("[orchestrator] callGroqChat.start", { attempt, withSystem: !!prompts.systemText, withRetrySystem: attempt > 1 && !!prompts.retryText });
      const r = await callGroqChat(messages, { json: true, temperature });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      console.log("[orchestrator] callGroqChat.done", { attempt, textLen: text.length });

      const parsed = extractJsonObject(text);
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
    // 不兜底：让构建失败（同时带上我们记录的错误与来源）
    const info = {
      reason: lastErr?.message || String(lastErr) || "unknown",
      trace: metaTrace,
    };
    console.error("[orchestrator] LLM failed (no contract)", info);
    throw new Error(`orchestrate_failed: ${info.reason}`);
  }

  // 写入 01_contract.json + meta._trace
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
