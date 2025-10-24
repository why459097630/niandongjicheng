// lib/ndjc/orchestrator.ts
// Strict Contract V1 orchestrator — JSON-only, with SKELETON + minimal SCHEMA fragment injection.

import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";

/** ---------------- types ---------------- */
type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

type TokenFileEntry = {
  name: string;
  path?: string;
  bytes?: number;
  approxTokens: number;
};

/* =========================================================
 * Orchestrator (strict Contract V1 pipeline, JSON-only)
 * =======================================================*/
export async function orchestrate(req: NdjcRequest) {
  const runId = req.runId ?? `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const templateKey = req.template_key ?? "circle-basic";
  const registry = registryJson as any;

  /* ---------- build system header (行为性约束，保持最小) ---------- */
  const sysHeader =
    "You are an expert NDJC Contract v1 generator.\n" +
    "Return EXACTLY ONE valid JSON object and nothing else (no Markdown or code fences).\n" +
    'Top-level keys in this exact order: "metadata" → "anchorsGrouped" → "files".\n' +
    'anchorsGrouped includes EXACTLY six groups: "text","block","list","if","hook","gradle".\n' +
    "All values MUST be Android-buildable. No placeholders such as 'ready','lorem','tbd','n/a','-','content ready for rendering'.\n" +
    "Booleans/integers MUST be native types (not strings). Objects MUST be JSON objects (not stringified JSON).\n" +
    'The "files" array MUST be empty.\n';

  /* ---------- read contract prompt text (.txt) ---------- */
  const promptPath = path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.en.txt");
  let promptText = "";
  let promptBytes = 0;
  try {
    const buf = await fs.readFile(promptPath);
    promptText = buf.toString("utf8");
    promptBytes = buf.byteLength;
  } catch (e: any) {
    throw new Error(`[orchestrate] Prompt file not found or unreadable: ${promptPath}\n${e.message}`);
  }

  /* ---------- build SKELETON (锁结构与键序) ---------- */
  const skeletonObj = buildSkeletonFromRegistry(registry);
  const skeletonJson = stableStringify(skeletonObj);

  /* ---------- build minimal SCHEMA fragment（只下发关键规则，避免双口径） ---------- */
  const schemaFragmentObj = buildMinimalSchemaFragment(registry);
  const schemaFragmentJson = stableStringify(schemaFragmentObj);

  /* ---------- inject placeholders if present in prompt file ---------- */
  const injectedPrompt = injectPromptPlaceholders(promptText, {
    SKELETON_JSON: skeletonJson,
    SCHEMA_FRAGMENT: schemaFragmentJson,
    PLACEHOLDER_BLACKLIST: JSON.stringify(registry.placeholderBlacklist ?? []),
  });

  /* ---------- prepare registry slices for the model (必要：required + topLevelOrder + blacklist) ---------- */
  const registryRequired = JSON.stringify(registry.required ?? {}, null, 2);
  const placeholderBlacklist = Array.isArray(registry.placeholderBlacklist) ? registry.placeholderBlacklist : [];
  const topLevelOrder = Array.isArray(registry.topLevelOrder)
    ? registry.topLevelOrder
    : ["metadata", "anchorsGrouped", "files"];

  /* ---------- merge into full system prompt ---------- */
  const fullSystemPrompt =
    `${sysHeader}\n` +
    `--- CONTRACT SPEC (Behavioral) ---\n${injectedPrompt}\n\n` +
    `--- REGISTRY REQUIRED (authoritative) ---\n${registryRequired}\n\n` +
    `--- TOP LEVEL ORDER (authoritative) ---\n${JSON.stringify(topLevelOrder)}\n\n` +
    `--- FORBIDDEN PLACEHOLDERS (authoritative) ---\n${JSON.stringify(placeholderBlacklist)}\n`;

  /* ---------- user message ---------- */
  const userNeed = (req.requirement ?? "").trim();
  const msgs: ChatMessage[] = [
    { role: "system", content: fullSystemPrompt },
    { role: "user", content: userNeed },
  ];

  /* ---------- token accounting (approx) ---------- */
  const approxTokens = (s: string) => Math.ceil((s ?? "").length / 4);
  const filesSent: TokenFileEntry[] = [
    { name: "contract_v1.en.txt (injected)", path: promptPath, bytes: promptBytes, approxTokens: approxTokens(injectedPrompt) },
    { name: "SKELETON_JSON (inlined json)", approxTokens: approxTokens(skeletonJson) },
    { name: "SCHEMA_FRAGMENT (inlined json)", approxTokens: approxTokens(schemaFragmentJson) },
    { name: "system.header (fixed text)", approxTokens: approxTokens(sysHeader) },
    { name: "registry.required (inlined json)", approxTokens: approxTokens(registryRequired) },
    { name: "topLevelOrder (inlined json)", approxTokens: approxTokens(JSON.stringify(topLevelOrder)) },
    { name: "placeholderBlacklist (inlined json)", approxTokens: approxTokens(JSON.stringify(placeholderBlacklist)) },
    { name: "user_requirement (inlined text)", approxTokens: approxTokens(userNeed) },
  ];
  const sentTokensTotal = filesSent.reduce((s, f) => s + (f.approxTokens || 0), 0);

  /* ---------- call LLM（采样参数在 groq.ts 里配置） ---------- */
  const model = process.env.NDJC_MODEL || "groq";
  const trace: any = {
    model,
    runId,
    templateKey,
    step: "orchestrate-online",
    tokenReport: {
      files: filesSent,
      sentTokensTotal,
      returnedTokens: 0,
      totalThisBuild: 0,
    },
    sentFilesSummary: filesSent.map((f) => `${f.name} ~${f.approxTokens} tok`).join(" | "),
  };

  let rawText = "";
  try {
    const r = await callGroqChat(msgs);
    rawText = typeof r === "string" ? r : (r as any)?.text ?? "";
    trace.raw = trimForTrace(rawText);
  } catch (e: any) {
    trace.error = e?.message ?? e;
    throw new Error(`[orchestrate] LLM call failed: ${trace.error}`);
  }

  // 记录返回 token 估算 & 合计
  const returnedTokens = approxTokens(rawText);
  trace.tokenReport.returnedTokens = returnedTokens;
  trace.tokenReport.totalThisBuild = sentTokensTotal + returnedTokens;

  /* ---------- parse JSON ---------- */
  let contract: any;
  try {
    contract = tryParseJson(rawText);
  } catch {
    throw new Error("Invalid JSON returned by LLM (not parsable). Ensure the model outputs JSON only.");
  }

  /* ---------- top-level validation ---------- */
  validateTopLevel(contract);

  /* ---------- metadata 补充（保持轻量，与原逻辑一致） ---------- */
  const grouped = contract.anchorsGrouped ?? {};
  const appLabel =
    req.appName ??
    grouped?.text?.["NDJC:APP_LABEL"] ??
    contract?.metadata?.appName ??
    "NDJC App";

  const applicationId =
    grouped?.gradle?.applicationId ??
    contract?.metadata?.packageId ??
    "com.example.ndjc";

  contract.metadata = {
    ...(contract.metadata ?? {}),
    template: contract?.metadata?.template ?? templateKey,
    appName: typeof appLabel === "string" ? appLabel : String(appLabel ?? "NDJC App"),
    packageId: typeof applicationId === "string" ? applicationId : String(applicationId ?? "com.example.ndjc"),
    mode: "A",
  };

  /* ---------- JSON-only: ensure files is an empty array ---------- */
  contract.files = [];

  /* ---------- light normalization ---------- */
  normalizeContract(contract);

  /* ---------- strict validation (non-empty & gradle) ---------- */
  validateAnchorsNonEmpty(contract);
  validateGradle(contract);

  /* ---------- output ---------- */
  return {
    ok: true,
    runId,
    step: "orchestrate-online",
    contract,
    trace,
  };
}

/* =========================================================
 * Build SKELETON from registry (锁定结构与键序)
 * =======================================================*/
function buildSkeletonFromRegistry(registry: any) {
  // 1) metadata
  const metadata = { "NDJC:BUILD_META:RUNID": "" };

  // 2) anchorsGrouped with fixed sub-order
  const textKeys: string[] = Array.isArray(registry.text) ? registry.text : [];
  const blockKeys: string[] = Array.isArray(registry.block) ? registry.block : [];
  const listKeys: string[] = Array.isArray(registry.list) ? registry.list : [];
  const ifKeys: string[] = Array.isArray(registry.if) ? registry.if : [];
  const hookKeys: string[] = Array.isArray(registry.hook) ? registry.hook : [];

  const text: Record<string, any> = {};
  textKeys.forEach((k) => (text[k] = "")); // 让模型来填类型；我们只锁键位

  const block: Record<string, any> = {};
  blockKeys.forEach((k) => (block[k] = ""));

  const list: Record<string, any> = {};
  listKeys.forEach((k) => (list[k] = []));

  const iff: Record<string, any> = {};
  ifKeys.forEach((k) => (iff[k] = false));

  const hook: Record<string, any> = {};
  hookKeys.forEach((k) => (hook[k] = "noop"));

  // gradle：只放三项（其余没有的话由模型决定是否填充）
  const gradle: Record<string, any> = {
    applicationId: "",
    resConfigs: [],
    permissions: [],
  };

  const anchorsGrouped = { text, block, list, if: iff, hook, gradle };

  // 3) files 固定为空数组
  const files: any[] = [];

  // 最终骨架（顶层顺序：metadata → anchorsGrouped → files）
  return { metadata, anchorsGrouped, files };
}

/* =========================================================
 * Build minimal SCHEMA fragment（只下发关键规则）
 * =======================================================*/
function buildMinimalSchemaFragment(registry: any) {
  const required = registry.required ?? {};
  const placeholderBlacklist = registry.placeholderBlacklist ?? [];
  const topLevelOrder = Array.isArray(registry.topLevelOrder)
    ? registry.topLevelOrder
    : ["metadata", "anchorsGrouped", "files"];

  // 7 条关键规则 + 跨字段
  const fragment = {
    topLevelOrder,
    required,
    crossField: {
      equals: [
        ["text.NDJC:BUILD_META:RUNID", "metadata.NDJC:BUILD_META:RUNID"],
        ["gradle.applicationId", "text.NDJC:PACKAGE_NAME"],
      ],
    },
    valueFormat: {
      text: {
        "NDJC:BUILD_META:RUNID": { regex: "^run_[0-9]{8}_[0-9]{3}$" },
        "NDJC:PACKAGE_NAME": { regex: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$" },
        "NDJC:DATA_SOURCE": { regex: "^https://[\\w.-]+(:\\d+)?(/.*)?$" },
        "NDJC:THEME_COLORS": {
          objectKeys: { primary: "^#[0-9A-Fa-f]{6}$", secondary: "^#[0-9A-Fa-f]{6}$" },
        },
      },
      list: {
        "LIST:ROUTES": { itemRegex: "^[a-z][a-z0-9_-]*$", minItems: 1 },
      },
      gradle: {
        applicationId: { regex: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$" },
        resConfigs: { itemRegex: "^[a-z]{2}(-r[A-Z]{2,3})?$", minItems: 1 },
        permissions: { itemRegex: "^android\\.permission\\.[A-Z_]+$", minItems: 1 },
      },
    },
    placeholderBlacklist,
  };

  return fragment;
}

/* =========================================================
 * Prompt placeholder injection (best-effort)
 * =======================================================*/
function injectPromptPlaceholders(
  text: string,
  vars: { SKELETON_JSON: string; SCHEMA_FRAGMENT: string; PLACEHOLDER_BLACKLIST: string }
) {
  // 允许模板中不包含这些占位符；若包含则替换
  let out = text;
  out = out.replaceAll("[[SKELETON_JSON]]", vars.SKELETON_JSON);
  out = out.replaceAll("[[SCHEMA_FRAGMENT]]", vars.SCHEMA_FRAGMENT);
  out = out.replaceAll("[[PLACEHOLDER_BLACKLIST]]", vars.PLACEHOLDER_BLACKLIST);
  return out;
}

/* =========================================================
 * JSON parsing / validation / normalization
 * =======================================================*/
function tryParseJson(text: string): any {
  if (!text) throw new Error("empty");
  // tolerate fenced blocks but prefer plain JSON
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function trimForTrace(s: string, max = 4000) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (${s.length - max} more chars)`;
}

function stableStringify(obj: any) {
  // Node 的 JSON.stringify 已按插入顺序输出；这里保底做一次浅层键排序（顶层顺序我们自己控制）
  return JSON.stringify(obj, null, 2);
}

function validateTopLevel(contract: any) {
  if (!contract || typeof contract !== "object") throw new Error("Contract V1 must be a JSON object.");
  const requiredTop = ["metadata", "anchorsGrouped", "files"];
  for (const key of requiredTop) {
    if (!(key in contract)) throw new Error(`Missing top-level key: ${key}`);
  }
}

function validateAnchorsNonEmpty(contract: any) {
  const grouped = contract.anchorsGrouped ?? {};
  const groups: Array<"text" | "block" | "list" | "if" | "hook" | "gradle"> = ["text", "block", "list", "if", "hook", "gradle"];

  // 允许为空对象的锚点白名单（方案A：对 NDJC:STRINGS_EXTRA 放宽）
  const allowEmptyObject = new Set<string>(["NDJC:STRINGS_EXTRA"]);

  for (const g of groups) {
    const dict = grouped[g];
    if (!dict || typeof dict !== "object") throw new Error(`Missing or invalid group: ${g}`);

    for (const [k, v] of Object.entries(dict)) {
      if (v == null) throw new Error(`Null value at ${g}:${k}`);
      if (typeof v === "string" && v.trim() === "") throw new Error(`Empty string at ${g}:${k}`);
      if (Array.isArray(v) && v.length === 0) throw new Error(`Empty array at ${g}:${k}`);

      if (typeof v === "object" && !Array.isArray(v)) {
        if (Object.keys(v).length === 0 && !allowEmptyObject.has(k)) {
          throw new Error(`Empty object at ${g}:${k}`);
        }
      }
    }
  }
}

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PERM_REGEX = /^android\.permission\.[A-Z_]+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2,3})?$/;

function validateGradle(contract: any) {
  const gradle = contract.anchorsGrouped?.gradle ?? {};
  const appId = gradle.applicationId;
  if (!appId || typeof appId !== "string" || !PKG_REGEX.test(appId)) {
    throw new Error(`Invalid gradle.applicationId: ${appId}`);
  }
  const resConfigs: string[] = Array.isArray(gradle.resConfigs) ? gradle.resConfigs : [];
  if (!resConfigs.length || !resConfigs.every((x) => LOCALE_ITEM.test(x))) {
    throw new Error(`Invalid gradle.resConfigs: ${JSON.stringify(resConfigs)}`);
  }
  const perms: string[] = Array.isArray(gradle.permissions) ? gradle.permissions : [];
  if (!perms.length || !perms.every((p) => PERM_REGEX.test(p))) {
    throw new Error(`Invalid gradle.permissions: ${JSON.stringify(perms)}`);
  }
}

/* =========================================================
 * Normalization (safe; no placeholders; no stringification)
 * =======================================================*/
function normalizeContract(contract: any) {
  const g = contract.anchorsGrouped ?? {};
  g.text ||= {};
  g.block ||= {};
  g.list ||= {};
  g.if ||= {};
  g.hook ||= {};
  g.gradle ||= {};

  // THEME_COLORS / STRINGS_EXTRA: keep as objects if possible (no stringified JSON).
  if (g.text["NDJC:THEME_COLORS"] != null) {
    g.text["NDJC:THEME_COLORS"] = normalizeJsonObject(g.text["NDJC:THEME_COLORS"], {
      primary: "#7C3AED",
      secondary: "#10B981",
    });
  }
  if (g.text["NDJC:STRINGS_EXTRA"] != null) {
    g.text["NDJC:STRINGS_EXTRA"] = normalizeJsonObject(g.text["NDJC:STRINGS_EXTRA"], {});
  }

  // IF group: coerce to boolean safely (model is expected to return booleans already).
  if (g.if && typeof g.if === "object") {
    for (const k of Object.keys(g.if)) {
      g.if[k] = toBool(g.if[k]);
    }
  }

  // Gradle.applicationId: normalize to valid package or fallback.
  g.gradle.applicationId = ensurePkg(g.gradle.applicationId, "com.example.ndjc");

  // resConfigs: filter to valid locale items; fallback to ["en"].
  let res: string[] = Array.isArray(g.gradle.resConfigs) ? g.gradle.resConfigs.map(String) : [];
  res = res.filter((x) => LOCALE_ITEM.test(x));
  if (!res.length) res = ["en"];
  g.gradle.resConfigs = res;

  // permissions: keep only valid Android permission constants; fallback to INTERNET.
  let perms: string[] = Array.isArray(g.gradle.permissions) ? g.gradle.permissions.map(String) : [];
  perms = perms.filter((p) => PERM_REGEX.test(p));
  if (!perms.length) perms = ["android.permission.INTERNET"];
  g.gradle.permissions = perms;

  contract.anchorsGrouped = g;

  // Sync NDJC:PACKAGE_NAME from applicationId if missing.
  if (!g.text["NDJC:PACKAGE_NAME"]) {
    g.text["NDJC:PACKAGE_NAME"] = g.gradle.applicationId;
  }
}

/* =========================================================
 * Small utils
 * =======================================================*/
function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  if (["true", "1", "yes", "y", "on", "enabled", "enable", "open", "是"].includes(s)) return true;
  if (["false", "0", "no", "n", "off", "disabled", "disable", "close", "否"].includes(s)) return false;
  return false;
}

function ensurePkg(v?: string, fallback = "com.example.ndjc") {
  let s = (v || "").trim().toLowerCase();
  s = s.replace(/[^a-z0-9_.]+/g, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
  return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(s) ? s : fallback;
}

function normalizeJsonObject(input: any, fallback: Record<string, any>) {
  // Already object
  if (input && typeof input === "object" && !Array.isArray(input)) return input;
  // String that is JSON
  if (typeof input === "string") {
    const s = input.trim();
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch {
      // not json, ignore
    }
  }
  // Fallback
  return { ...fallback };
}
