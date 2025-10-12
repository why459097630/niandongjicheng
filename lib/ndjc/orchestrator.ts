// lib/ndjc/orchestrator.ts
// 需求：
// 1) 在输出的 requests/<RUN_ID>/01_contract.json 中写入 meta.trace（包含提示词/注册表路径与哈希、模型、重试次数、错误等）
// 2) 移除编排器内“内置提示词”（不再硬编码任何 system / retry 文本）；只从文件读取，读不到就不附加。
//    ——满足你“删除编排器里的提示词”的要求，同时保留从文件加载提示词的能力与可观测性。

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

type CallLLMArgs = {
  messages: ChatMsg[];
  model: string;
  temperature?: number;
  maxTokens?: number;
};
type CallLLMFn = (args: CallLLMArgs) => Promise<{ content: string }>;

type OfflineContractArgs = { userInput: string; registry: any };
type OfflineContractFn = (args: OfflineContractArgs) => Promise<any>;

type OrchestrateParams = {
  runId: string;
  userInput: string;
  outDirRoot?: string;

  // 外部文件（可由环境变量或调用方覆盖）
  promptSystemFile?: string; // e.g. lib/ndjc/prompts/contract_v1.en.json
  promptRetryFile?: string;  // e.g. lib/ndjc/prompts/contract_v1.retry.en.txt
  registryFile?: string;     // e.g. lib/ndjc/anchors/registry.circle-basic.json

  // LLM 参数
  model?: string;
  maxRetry?: number;
  temperature?: number;

  // 依赖注入（测试/替换方便）
  callLLM?: CallLLMFn;
  offlineContract?: OfflineContractFn;
};

export type NdjcOrchestratorOutput = {
  run_id: string;
  ok: boolean;
  contract_path: string;
  model: string;
  meta: {
    trace: {
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
  };
};

// -------- 默认配置（不包含任何内置提示词文本，仅文件路径 & 模型等）--------
const DEFAULT_PROMPT_SYSTEM_FILE =
  process.env.NDJC_PROMPT_SYSTEM_FILE || 'lib/ndjc/prompts/contract_v1.en.json';
const DEFAULT_PROMPT_RETRY_FILE =
  process.env.NDJC_PROMPT_RETRY_FILE || 'lib/ndjc/prompts/contract_v1.retry.en.txt';
const DEFAULT_REGISTRY_FILE =
  process.env.NDJC_REGISTRY_FILE || 'lib/ndjc/anchors/registry.circle-basic.json';

const DEFAULT_MODEL = process.env.NDJC_LLM_MODEL || 'gpt-4o-mini';
const DEFAULT_MAX_RETRY = Number(process.env.NDJC_LLM_MAX_RETRY || 2);
const DEFAULT_TEMPERATURE = Number(process.env.NDJC_LLM_TEMPERATURE || 0);

// 运行期依赖（按需懒加载，避免循环依赖）
async function _callLLMImpl(args: CallLLMArgs) {
  const { callLLM } = await import('./orchestrate/groq');
  return callLLM(args);
}
async function _offlineContractImpl(args: OfflineContractArgs) {
  const { offlineContract } = await import('./orchestrate/offline');
  return offlineContract(args);
}

// -------- 工具函数（不改变项目其他结构）--------
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readFileMaybe(filePath?: string): Promise<{
  ok: boolean; absPath?: string; text?: string; sha1?: string; err?: string;
}> {
  if (!filePath) return { ok: false, err: 'empty_path' };
  try {
    const abs = path.resolve(filePath);
    const buf = await fs.readFile(abs);
    const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
    return { ok: true, absPath: abs, text: buf.toString('utf-8'), sha1 };
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

// 从模型回复中尽力提取第一段 JSON 对象
function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// -------- 主入口：orchestrate（仅文件提示词，无内置字符串）--------
export async function orchestrate(params: OrchestrateParams): Promise<NdjcOrchestratorOutput> {
  const {
    runId,
    userInput,
    outDirRoot = 'requests',

    promptSystemFile = DEFAULT_PROMPT_SYSTEM_FILE,
    promptRetryFile = DEFAULT_PROMPT_RETRY_FILE,
    registryFile = DEFAULT_REGISTRY_FILE,

    model = DEFAULT_MODEL,
    maxRetry = DEFAULT_MAX_RETRY,
    temperature = DEFAULT_TEMPERATURE,

    callLLM = _callLLMImpl,
    offlineContract = _offlineContractImpl,
  } = params;

  const reqDir = path.join(outDirRoot, String(runId));
  await ensureDir(reqDir);

  // 1) 加载“注册表 + 提示词（仅从文件）”
  const [reg, sys, rty] = await Promise.all([
    readJsonMaybe<any>(registryFile),
    readFileMaybe(promptSystemFile),
    readFileMaybe(promptRetryFile),
  ]);

  // 2) 组装 meta.trace（用于写入 01_contract.json）
  const metaTrace: NdjcOrchestratorOutput['meta']['trace'] = {
    prompt_file: sys.ok ? sys.absPath : undefined,
    prompt_sha1: sys.ok ? sys.sha1 : undefined,
    retry_file: rty.ok ? rty.absPath : undefined,
    retry_sha1: rty.ok ? rty.sha1 : undefined,
    registry_file: reg.ok ? reg.absPath : undefined,
    registry_sha1: reg.ok ? reg.sha1 : undefined,
    model,
    attempts: 0,
    timestamp: new Date().toISOString(),
    errors: [],
  };

  if (!reg.ok) metaTrace.errors.push(`registry:${reg.err}`);
  if (!sys.ok) metaTrace.errors.push(`system_prompt:${sys.err}`);
  if (!rty.ok) metaTrace.errors.push(`retry_prompt:${rty.err}`);

  // 3) 组织消息：仅当“文件存在且读取成功”才注入 system / retry 消息
  const baseMessages: ChatMsg[] = [];
  if (sys.ok && sys.text) baseMessages.push({ role: 'system', content: sys.text });
  baseMessages.push({ role: 'user', content: userInput });

  // 4) LLM 调用（带重试）。不再有“硬编码 retry 文本”，只有 retry 文件存在时才追加。
  let contractObj: any | null = null;
  let lastErr: any = null;

  const tries = Math.max(1, maxRetry);
  for (let attempt = 1; attempt <= tries; attempt++) {
    metaTrace.attempts = attempt;

    let messages = baseMessages;
    if (attempt > 1 && rty.ok && rty.text) {
      messages = [{ role: 'system', content: rty.text }, ...baseMessages];
    }

    try {
      const reply = await callLLM({
        messages,
        model,
        temperature,
        maxTokens: 4096,
      });
      const parsed = extractJsonObject(reply?.content || '');
      if (parsed && typeof parsed === 'object') {
        contractObj = parsed;
        break;
      }
      lastErr = new Error('extract_json_failed');
    } catch (e: any) {
      lastErr = e;
    }
  }

  // 5) 兜底：LLM 失败或返回非法 JSON → 走 offline（基于注册表生成最小可用契约）
  if (!contractObj) {
    metaTrace.errors.push(`llm_failed:${lastErr?.message || String(lastErr) || 'unknown'}`);
    const registryData = reg.ok ? reg.data : {};
    contractObj = await offlineContract({ userInput, registry: registryData });
  }

  // 6) 将 trace 写入契约（01_contract.json）
  if (!contractObj.meta) contractObj.meta = {};
  contractObj.meta._trace = metaTrace;

  const out01 = path.join(reqDir, '01_contract.json');
  await fs.writeFile(out01, JSON.stringify(contractObj, null, 2), 'utf-8');

  // 7) 返回结果（不改变原有调用者依赖的关键字段）
  const result: NdjcOrchestratorOutput = {
    run_id: runId,
    ok: true,
    contract_path: out01,
    model,
    meta: { trace: metaTrace },
  };

  return result;
}

export default orchestrate;
