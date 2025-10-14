// lib/ndjc/orchestrator.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "node:fs/promises";
import path from "node:path";
import { callGroqChat } from "./groq"; // 你项目里已有的封装（方案 A/B 都可），只需保证签名一致
// 如果你的 groq 封装导出名不同，改这一行即可。

/** ---------- 类型（轻量） ---------- */
export type GenerateApkRequest = {
  nl: string;                      // 自然语言需求
  mode?: string;                   // "A" | "B"
  template_key?: string;           // 例如 "circle-basic"
  template?: string;               // 兼容旧字段
  allowCompanions?: boolean;
  appName?: string;                // 可选：前端直给
  packageId?: string;              // 可选：前端直给
};

export type AnchorsGrouped = Record<string, any>;

export type ContractV1 = {
  contract: "v1";
  metadata: {
    appName: string;
    packageId: string;
    template: string;
    mode: string;
    allowCompanions: boolean;
  };
  nl: string;
  anchorsGrouped: AnchorsGrouped;
};

/** ---------- 常量路径 ---------- */
const ROOT = process.cwd();
const PROMPTS_DIR = path.join(ROOT, "lib", "ndjc", "prompts");
const ANCHORS_DIR = path.join(ROOT, "lib", "ndjc", "anchors");

const SYSTEM_PROMPT_FILE = path.join(PROMPTS_DIR, "contract_v1.en.json");
const RETRY_PROMPT_FILE = path.join(PROMPTS_DIR, "contract_v1.retry.en.txt");

// 可选：用于日志/对齐（不会影响功能）
const REGISTRY_FILE = path.join(ANCHORS_DIR, "registry.circle-basic.json");

/** ---------- 工具 ---------- */
function safeAppName(s?: string): string {
  const name = (s ?? "").trim();
  return name.length > 0 ? name : "NDJC App";
}
function safePackageId(s?: string): string {
  const input = (s ?? "").trim().toLowerCase();
  const ok = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(input);
  if (ok) return input;
  // 简单兜底，避免再被校验器拦截
  return `com.ndjc.${Math.random().toString(36).slice(2, 10)}`;
}
function nonEmpty(s?: string): string {
  return (s ?? "").trim();
}

/** 简单 JSON 校验（用于区分 E_NOT_JSON） */
function parseJSON<T = unknown>(raw: string): { ok: true; data: T } | { ok: false; err: Error } {
  try {
    const data = JSON.parse(raw) as T;
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, err };
  }
}

/** ---------- 读取提示词/锚点清单 ---------- */
async function loadSystemPrompt(): Promise<{ core_prompt: string; schema?: any; few_shots?: any[]; retry_instructions?: string }> {
  const raw = await fs.readFile(SYSTEM_PROMPT_FILE, "utf8");
  return JSON.parse(raw);
}
async function loadRetryPrompt(): Promise<string> {
  return fs.readFile(RETRY_PROMPT_FILE, "utf8");
}
async function loadRegistryText(): Promise<string> {
  try {
    const raw = await fs.readFile(REGISTRY_FILE, "utf8");
    return raw;
  } catch {
    return "";
  }
}

/** ---------- 组装 LLM 输入 ---------- */
function buildMessages({
  core_prompt,
  schema,
  few_shots,
}: {
  core_prompt: string;
  schema?: any;
  few_shots?: any[];
}, nl: string) {
  // System：只描述“返回 anchorsGrouped”，不要 metadata
  const system = [
    `You are NDJC's Contract generator for building a native Android APK.`,
    `Return STRICT JSON only with this single top-level object:`,
    `{ "anchorsGrouped": { ... } }`,
    `Do NOT include "metadata" in your output.`,
    ``,
    core_prompt,
    schema ? `\n# Schema (validation hints)\n${JSON.stringify(schema)}` : "",
    few_shots ? `\n# Few-shot examples (good/bad)\n${JSON.stringify(few_shots)}` : "",
  ].join("\n");

  const user = [
    `# BUILD GOAL`,
    `We are building a native Android APK from the user's requirement below.`,
    `Every anchor in the whitelist MUST be filled with a build-usable value (no placeholders/empty/default).`,
    ``,
    `# USER REQUIREMENT (Chinese allowed)`,
    nl,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ] as { role: "system" | "user"; content: string }[];
}

/** ---------- 元数据构造（此次关键改动） ---------- */
function buildMetadata(req: GenerateApkRequest) {
  const templateResolved = nonEmpty(req.template_key) || nonEmpty(req.template);
  const metadata = {
    appName: safeAppName(req.appName),
    packageId: safePackageId(req.packageId),
    template: templateResolved,                 // ← 关键：把 template_key / template 映射到 metadata.template
    mode: nonEmpty(req.mode) || "B",
    allowCompanions: Boolean(req.allowCompanions ?? true),
  };
  return metadata;
}

function metaPrecheck(metadata: ContractV1["metadata"]) {
  const errors: { code: string; message: string; path: string }[] = [];
  if (!metadata.template) errors.push({ code: "E_META_TEMPLATE", message: "metadata.template must be a non-empty string", path: "metadata.template" });
  if (!metadata.appName) errors.push({ code: "E_META_APPNAME", message: "metadata.appName must be a non-empty string", path: "metadata.appName" });
  if (!metadata.packageId) errors.push({ code: "E_META_PACKAGE", message: "metadata.packageId must be a non-empty string", path: "metadata.packageId" });
  return errors;
}

/** ---------- 对外主函数 ---------- */
export async function runOrchestrator(req: GenerateApkRequest): Promise<{
  ok: boolean;
  step?: "contract-precheck" | "contract-llm" | "contract-validate" | "contract-retry" | "done";
  reason?: Array<{ code: string; message: string; path: string }>;
  contract?: ContractV1;
  raw?: string;
}> {
  // 读取日志信息（非必需）
  void loadRegistryText().catch(() => undefined);

  // 1) 统一构造 metadata（关键修复点）
  const metadata = buildMetadata(req);

  // 2) 进入任何流程前，做强 precheck，避免 400（E_META_*）
  const metaIssues = metaPrecheck(metadata);
  if (metaIssues.length) {
    return {
      ok: false,
      step: "contract-precheck",
      reason: metaIssues,
    };
  }

  // 3) 读取系统/重试提示词
  const sysPrompt = await loadSystemPrompt();
  const retryPrompt = await loadRetryPrompt();

  // 4) 组装并调用 LLM
  const messages = buildMessages(sysPrompt, req.nl);
  const raw = await callGroqChat(messages, {
    // 这些参数与你的 groq.ts 对齐；若不支持就移除
    temperature: 0,
    max_tokens: 2048,
    top_p: 1,
  });

  // 5) JSON 解析（解决 E_NOT_JSON）
  const parsed = parseJSON<{ anchorsGrouped: AnchorsGrouped }>(raw);
  if (!parsed.ok || !parsed.data || typeof parsed.data.anchorsGrouped !== "object") {
    return {
      ok: false,
      step: "contract-llm",
      reason: [{ code: "E_NOT_JSON", message: "No raw LLM text to validate", path: "<root>" }],
      raw,
    };
  }

  // 6) 组装最终契约对象（LLM 只负责 anchorsGrouped；metadata 由服务端合成）
  const finalContract: ContractV1 = {
    contract: "v1",
    metadata,
    nl: req.nl,
    anchorsGrouped: parsed.data.anchorsGrouped,
  };

  // 7) 最小合规校验（把显而易见的问题拦在本地；更严格的仍交给后续 validator）
  const bad = checkForObviousViolations(finalContract);
  if (bad.length) {
    // 这里给一次“提示词重试”的机会（可选）
    const retryRaw = await callGroqChat(
      [
        { role: "system", content: sysPrompt.core_prompt },
        {
          role: "user",
          content: [
            `The previous output has issues:`,
            JSON.stringify(bad, null, 2),
            ``,
            `# Retry Instruction`,
            retryPrompt,
            ``,
            `# Return STRICT JSON: { "anchorsGrouped": { ... } }`,
          ].join("\n"),
        },
      ],
      { temperature: 0, max_tokens: 2048, top_p: 1 }
    );

    const retryParsed = parseJSON<{ anchorsGrouped: AnchorsGrouped }>(retryRaw);
    if (retryParsed.ok && retryParsed.data && typeof retryParsed.data.anchorsGrouped === "object") {
      finalContract.anchorsGrouped = retryParsed.data.anchorsGrouped;
    } else {
      return {
        ok: false,
        step: "contract-retry",
        reason: [{ code: "E_NOT_JSON", message: "Retry still not a valid JSON anchorsGrouped", path: "<root>" }],
        raw: retryRaw,
      };
    }
  }

  // 8) 到此为止：返回契约对象；后续的“统一校验/落盘/构建”沿用你项目原有流程
  return {
    ok: true,
    step: "done",
    contract: finalContract,
  };
}

/** ---------- 轻量“显而易见问题”检查（本地） ---------- */
function checkForObviousViolations(contract: ContractV1) {
  const issues: Array<{ code: string; message: string; path: string }> = [];

  // 约束：禁止空串/空对象/空数组/null
  const denyEmpty = (v: any) =>
    v === "" || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v && Object.keys(v).length === 0);

  // 简单扫描 anchorsGrouped 的一层（避免过重）
  const ag = contract.anchorsGrouped || {};
  for (const [k, v] of Object.entries(ag)) {
    if (denyEmpty(v)) {
      issues.push({
        code: "E_EMPTY_VALUE",
        message: `anchor "${k}" must not be empty ("", [], {} or null)`,
        path: `anchorsGrouped.${k}`,
      });
    }
  }

  // 若存在必须是 Kotlin 片段的锚点（如 block 组），可以做个轻量特征校验
  // 这里只做关键词检测，真正的语法正确性仍交给构建期
  const blockLike = ["block", "BLOCK", "kotlin", "compose"].filter((name) => ag[name]);
  for (const name of blockLike) {
    const txt = String(ag[name] ?? "");
    const hasToken = /@Composable|LazyColumn|Modifier\.|fun\s+/.test(txt);
    if (!hasToken || !balancedBrackets(txt)) {
      issues.push({
        code: "E_BLOCK_UNCOMPILABLE",
        message: `anchor "${name}" should look like compilable Kotlin/Compose (@Composable|fun|LazyColumn|Modifier., with balanced brackets/quotes)`,
        path: `anchorsGrouped.${name}`,
      });
    }
  }

  return issues;
}

function balancedBrackets(s: string) {
  // 非严格，仅避免明显不平衡
  const pairs: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const stack: string[] = [];
  for (const ch of s) {
    if (ch in pairs) stack.push(ch);
    else if (Object.values(pairs).includes(ch)) {
      const last = stack.pop();
      if (!last || pairs[last] !== ch) return false;
    }
  }
  // 引号平衡（粗略）
  const quotes = (s.match(/"/g) || []).length;
  return stack.length === 0 && quotes % 2 === 0;
}
