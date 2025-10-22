// lib/ndjc/orchestrator.ts
// (strict mode aligned with Contract V1 hard constraints, using .txt prompt file
//  + post-LLM normalization to prevent 422 on common field-format issues)

import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";
import rulesJson from "@/lib/ndjc/rules/ndjc-rules.json";

/** Local chat types to satisfy TS (callGroqChat expects mutable array) */
type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

/* =========================================================
 * Orchestrator (strict Contract V1 pipeline)
 * =======================================================*/

export async function orchestrate(req: NdjcRequest) {
  const runId =
    req.runId ?? `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const templateKey = req.template_key ?? "circle-basic";

  /* ---------- build system prompt ---------- */
  const registry = registryJson;
  const rules = rulesJson;

  const sysPrompt =
    "You are an expert language model tasked with generating an NDJC Contract V1 JSON. " +
    "Follow the schema strictly, return JSON only (no markdown), and fill every anchor with a non-empty, Android-buildable value.";

  /* ---------- read contract prompt text (.txt file) ---------- */
  const promptPath = path.join(
    process.cwd(),
    "lib/ndjc/prompts/contract_v1.en.txt"
  );
  let promptText = "";
  try {
    promptText = await fs.readFile(promptPath, "utf8");
  } catch (e: any) {
    throw new Error(
      `[orchestrate] Prompt file not found or unreadable: ${promptPath}\n${e.message}`
    );
  }

  /* ---------- merge all into a full system prompt ---------- */
  const fullPrompt =
    `${sysPrompt}\n\n---CONTRACT SPEC---\n${promptText}\n\n` +
    `Registry required keys:\n${JSON.stringify(registry.required ?? {}, null, 2)}\n\n` +
    `Gradle rules:\n${JSON.stringify(rules.gradle ?? {}, null, 2)}\n\n` +
    (req.requirement ? `User requirement:\n${req.requirement}\n` : "");

  /* ---------- build chat message (mutable array, no "as const") ---------- */
  const msgs: ChatMessage[] = [
    { role: "system", content: fullPrompt },
    { role: "user", content: req.requirement ?? "" },
  ];

  /* ---------- call LLM ---------- */
  const model = process.env.NDJC_MODEL || "groq";
  const trace: any = { model, runId, templateKey, step: "orchestrate-online" };

  let rawText = "";
  try {
    const r = await callGroqChat(msgs, { temperature: 0 });
    rawText = typeof r === "string" ? r : (r as any)?.text ?? "";
    trace.raw = trimForTrace(rawText);
  } catch (e: any) {
    trace.error = e?.message ?? e;
    throw new Error(`[orchestrate] LLM call failed: ${trace.error}`);
  }

  /* ---------- parse JSON ---------- */
  let contract: any;
  try {
    contract = tryParseJson(rawText);
  } catch {
    throw new Error(
      "Invalid JSON returned by LLM (not parsable). Ensure the model outputs JSON only."
    );
  }

  /* ---------- strict validation (top-level keys) ---------- */
  validateTopLevel(contract);

  /* ---------- metadata 强制补齐兜底（避免 422） ---------- */
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
    template: templateKey || contract?.metadata?.template || "circle-basic",
    appName: String(appLabel),
    packageId: String(applicationId),
    mode: "B",
  };

  /* ---------- NEW: LLM 后本地规范化修复（最小必需集） ---------- */
  normalizeContract(contract);

  /* ---------- continue strict validation ---------- */
  validateAnchorsNonEmpty(contract);
  validateGradle(contract);

  /* ---------- output ---------- */
  return {
    ok: true,
    runId,
    step: "orchestrate-online",
    contract,
  };
}

/* =========================================================
 * Normalization helpers (post-LLM)
 * =======================================================*/

function normalizeContract(contract: any) {
  const g = contract.anchorsGrouped ?? {};
  g.text ||= {};
  g.list ||= {};
  g.if ||= {};
  g.gradle ||= {};

  // 1) THEME_COLORS：允许 (#RRGGBB,#RRGGBB) 或对象 → 统一为字符串化 JSON
  if (g.text["NDJC:THEME_COLORS"] != null) {
    g.text["NDJC:THEME_COLORS"] = normalizeThemeColors(
      g.text["NDJC:THEME_COLORS"]
    );
  }

  // 2) ROUTES：中文/空格等 → slug 化；过滤不合规；至少保留 home
  if (Array.isArray(g.list["LIST:ROUTES"])) {
    const slugs = g.list["LIST:ROUTES"]
      .map((x: any) => toSlug(String(x)))
      .filter((s: string) => /^[a-z][a-z0-9_-]*$/.test(s));
    g.list["LIST:ROUTES"] = slugs.length ? slugs : ["home"];
  }

  // 3) IF:*：各种字符串/中文 → 布尔化
  if (g.if && typeof g.if === "object") {
    for (const k of Object.keys(g.if)) {
      g.if[k] = toBool(g.if[k]);
    }
  }

  // 4) Gradle：非空兜底 + 逐项过滤
  g.gradle.applicationId = ensurePkg(g.gradle.applicationId, "com.example.ndjc");

  // resConfigs
  const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2})?$/;
  let res: string[] = Array.isArray(g.gradle.resConfigs)
    ? g.gradle.resConfigs.map((s: any) => String(s))
    : [];
  res = res.filter((x) => LOCALE_ITEM.test(x));
  if (!res.length) res = ["en"];
  g.gradle.resConfigs = res;

  // permissions
  const PERM = /^android\.permission\.[A-Z_]+$/;
  let perms: string[] = Array.isArray(g.gradle.permissions)
    ? g.gradle.permissions.map((s: any) => String(s))
    : [];
  perms = perms.filter((p) => PERM.test(p));
  if (!perms.length) perms = ["android.permission.INTERNET"];
  g.gradle.permissions = perms;

  contract.anchorsGrouped = g;

  // 同步 NDJC:PACKAGE_NAME = applicationId（若缺失）
  if (!g.text["NDJC:PACKAGE_NAME"]) {
    g.text["NDJC:PACKAGE_NAME"] = g.gradle.applicationId;
  }
}

function normalizeThemeColors(v: any): string {
  // 已经是对象 → 直接 JSON.stringify
  if (v && typeof v === "object") {
    const primary = pickColor(v.primary);
    const secondary = pickColor(v.secondary);
    return JSON.stringify({ primary, secondary });
  }
  // 字符串 → 尝试按 " #RRGGBB , #RRGGBB " 解析
  const s = String(v ?? "").trim();
  // 已经是合法字符串化 JSON 就放行
  try {
    const maybe = JSON.parse(s);
    if (maybe && typeof maybe === "object" && maybe.primary && maybe.secondary) {
      return JSON.stringify({
        primary: pickColor(maybe.primary),
        secondary: pickColor(maybe.secondary),
      });
    }
  } catch {}
  const m = s.match(/#([0-9a-fA-F]{6})\s*,\s*#([0-9a-fA-F]{6})/);
  if (m) {
    return JSON.stringify({
      primary: `#${m[1]}`,
      secondary: `#${m[2]}`,
    });
  }
  // 回退默认配色（安全可构建）
  return JSON.stringify({ primary: "#7C3AED", secondary: "#10B981" });
}

function pickColor(c: any): string {
  const m = String(c ?? "").match(/^#([0-9a-fA-F]{6})$/);
  return m ? `#${m[1]}` : "#7C3AED";
}

function toSlug(s: string): string {
  // 常见中文到英文的极简映射（可按需扩充）
  const map: Record<string, string> = {
    菜单: "menu",
    评论: "reviews",
    上传照片: "upload",
    上传: "upload",
    照片: "photos",
    首页: "home",
    主页: "home",
  };
  if (map[s]) return map[s];
  // 拉丁化近似：去空白、中文转拼音可后续接入；此处最小实现
  const ascii = s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  // 必须以字母开头，不符合则回退 "page"
  return /^[a-z]/.test(ascii) ? ascii : "page";
}

function toBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  // 常见真值
  if (["true", "1", "yes", "y", "on", "enabled", "enable", "open", "是"].includes(s)) return true;
  // 常见假值
  if (["false", "0", "no", "n", "off", "disabled", "disable", "close", "否"].includes(s)) return false;
  // 既不是明显真也不是假 → 默认 false（保守）
  return false;
}

function ensurePkg(v?: string, fallback = "com.example.ndjc") {
  let s = (v || "").trim().toLowerCase();
  s = s.replace(/[^a-z0-9_.]+/g, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
  return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(s) ? s : fallback;
}

/* =========================================================
 * Validation helpers
 * =======================================================*/

function tryParseJson(text: string): any {
  if (!text) throw new Error("empty");
  // allow fenced code but prefer raw JSON
  const m =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  return JSON.parse(raw);
}

function trimForTrace(s: string, max = 4000) {
  if (!s) return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (${s.length - max} more chars)`;
}

function validateTopLevel(contract: any) {
  if (!contract || typeof contract !== "object") {
    throw new Error("Contract V1 must be a JSON object.");
  }
  const requiredTop = ["metadata", "anchorsGrouped", "files"];
  for (const key of requiredTop) {
    if (!(key in contract)) {
      throw new Error(`Missing top-level key: ${key}`);
    }
  }
}

function validateAnchorsNonEmpty(contract: any) {
  const grouped = contract.anchorsGrouped ?? {};
  const groups: Array<"text" | "block" | "list" | "if" | "hook" | "gradle"> = [
    "text",
    "block",
    "list",
    "if",
    "hook",
    "gradle",
  ];
  for (const g of groups) {
    const dict = grouped[g];
    if (!dict || typeof dict !== "object") {
      throw new Error(`Missing or invalid group: ${g}`);
    }
    for (const [k, v] of Object.entries(dict)) {
      if (v == null) throw new Error(`Null value at ${g}:${k}`);
      if (typeof v === "string" && v.trim() === "")
        throw new Error(`Empty string at ${g}:${k}`);
      if (v === "__NDJC_PLACEHOLDER__")
        throw new Error(`Placeholder not allowed at ${g}:${k}`);
      if (Array.isArray(v) && v.length === 0)
        throw new Error(`Empty array at ${g}:${k}`);
    }
  }
}

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PERM_REGEX = /^android\.permission\.[A-Z_]+$/;
const LOCALE_ITEM = /^[a-z]{2}(-r[A-Z]{2})?$/;

function validateGradle(contract: any) {
  const gradle = contract.anchorsGrouped?.gradle ?? {};
  const appId = gradle.applicationId;
  if (!appId || typeof appId !== "string" || !PKG_REGEX.test(appId)) {
    throw new Error(`Invalid gradle.applicationId: ${appId}`);
  }
  const resConfigs: string[] = Array.isArray(gradle.resConfigs)
    ? gradle.resConfigs
    : [];
  if (!resConfigs.length || !resConfigs.every((x) => LOCALE_ITEM.test(x))) {
    throw new Error(`Invalid gradle.resConfigs: ${JSON.stringify(resConfigs)}`);
  }
  const perms: string[] = Array.isArray(gradle.permissions)
    ? gradle.permissions
    : [];
  if (!perms.length || !perms.every((p) => PERM_REGEX.test(p))) {
    throw new Error(`Invalid gradle.permissions: ${JSON.stringify(perms)}`);
  }
}
