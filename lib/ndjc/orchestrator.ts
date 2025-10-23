// lib/ndjc/orchestrator.ts
// (strict mode aligned with Contract V1 hard constraints, using .txt prompt file
//  + post-LLM normalization + Scheme A: fill ALL anchors from registry/defaults (no placeholders))

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
  const registry = registryJson as any;
  const rules = rulesJson as any;

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

  /* ---------- build chat message (mutable array) ---------- */
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

  /* ---------- metadata 强制补齐兜底 ---------- */
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
    mode: "A",
  };

  /* ---------- Scheme A: 补齐所有锚点（无占位符） ---------- */
  fillAllAnchorsNoPlaceholder(contract, registry);

  /* ---------- 规范化（routes/if/themeColors/gradle） ---------- */
  normalizeContract(contract);

  /* ---------- 最终严格校验 ---------- */
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
 * Scheme A: 填满所有锚点（优先 registry.defaults；否则给安全值）
 * =======================================================*/

function fillAllAnchorsNoPlaceholder(contract: any, registry: any) {
  const g = (contract.anchorsGrouped = contract.anchorsGrouped ?? {});
  g.text = g.text ?? {};
  g.block = g.block ?? {};
  g.list = g.list ?? {};
  g.if = g.if ?? {};
  g.hook = g.hook ?? {};
  g.gradle = g.gradle ?? {};

  const defaults = (registry.defaults ?? {}) as any;

  const textKeys: string[] = registry.text ?? [];
  const blockKeys: string[] = registry.block ?? [];
  const listKeys: string[] = registry.list ?? [];
  const ifKeys: string[] = registry.if ?? [];
  const hookKeys: string[] = registry.hook ?? [];

  // text: 优先 defaults.text[key]；否则给可构建的安全值
  for (const k of textKeys) {
    const v = g.text[k];
    if (!hasNonEmpty(v)) {
      const def = defaults.text?.[k];
      g.text[k] = ensureTextDefault(k, def, g);
    }
  }

  // block: 优先 defaults（一般没有）；否则给最小 30 长度的安全块
  for (const k of blockKeys) {
    const v = g.block[k];
    if (!hasNonEmpty(v)) {
      const def = defaults.block?.[k];
      g.block[k] = ensureBlockDefault(k, def);
    }
  }

  // list: 优先 defaults.list[key]；否则至少 1 项（按语义给）
  for (const k of listKeys) {
    const v = Array.isArray(g.list[k]) ? g.list[k] : [];
    if (!v.length) {
      const def = Array.isArray(defaults.list?.[k]) ? defaults.list[k] : null;
      g.list[k] = ensureListDefault(k, def);
    }
  }

  // if: 统一布尔，缺省 false
  for (const k of ifKeys) {
    const v = g.if[k];
    if (typeof v !== "boolean") g.if[k] = false;
  }

  // hook: 缺省给短字符串（非空）
  for (const k of hookKeys) {
    const v = g.hook[k];
    if (!hasNonEmpty(v)) {
      g.hook[k] = defaults.hook?.[k] ?? "ready";
    }
  }

  // gradle: applicationId 先维持现值，resConfigs/permissions 留给 normalize 统一处理
  if (!g.gradle || typeof g.gradle !== "object") g.gradle = {};
  if (!hasNonEmpty(g.gradle.applicationId)) {
    g.gradle.applicationId =
      g.text["NDJC:PACKAGE_NAME"] ?? g.gradle.applicationId ?? "com.example.ndjc";
  }
}

/* ---------- text 默认值策略 ---------- */
function ensureTextDefault(key: string, def: any, g: any): string {
  if (hasNonEmpty(def)) return String(def);

  if (key === "NDJC:PACKAGE_NAME") return String(g?.gradle?.applicationId ?? "com.example.ndjc");
  if (key === "NDJC:APP_LABEL") return "NDJC App";
  if (key === "NDJC:HOME_TITLE") return "Home";
  if (key === "NDJC:PRIMARY_BUTTON_TEXT") return "Create";
  if (key === "NDJC:THEME_COLORS") return JSON.stringify({ primary: "#7C3AED", secondary: "#10B981" });
  if (key === "NDJC:PRIVACY_POLICY") return "https://example.com/privacy";

  return "value";
}

/* ---------- block 默认值（最少 30 字符） ---------- */
function ensureBlockDefault(_key: string, def: any): string {
  const val = hasNonEmpty(def) ? String(def) : "content ready for rendering";
  return padMin(val, 30);
}

/* ---------- list 默认值（按语义） ---------- */
function ensureListDefault(key: string, def: any[] | null): any[] {
  if (def && def.length) return def.map(String);
  if (key === "LIST:ROUTES") return ["home"];
  if (key === "LIST:DEPENDENCY_SNIPPETS") return ["implementation 'androidx.core:core-ktx:1.10.0'"];
  if (key === "LIST:PROGUARD_EXTRA") return ["-keep class com.ndjc.** { *; }"];
  if (key === "LIST:PACKAGING_RULES") return ["resources.exclude META-INF/DEPENDENCIES"];
  if (key === "LIST:RES_CONFIGS_OVERRIDE") return ["en"];
  return ["item"];
}

/* =========================================================
 * Post-LLM normalization (same as previous strict version)
 * =======================================================*/

function normalizeContract(contract: any) {
  const g = contract.anchorsGrouped ?? {};
  g.text ||= {};
  g.list ||= {};
  g.if ||= {};
  g.gradle ||= {};

  // 1) THEME_COLORS 标准化为字符串化 JSON 对象
  if (g.text["NDJC:THEME_COLORS"] != null) {
    g.text["NDJC:THEME_COLORS"] = normalizeThemeColors(
      g.text["NDJC:THEME_COLORS"]
    );
  }

  // 2) ROUTES slug 化 + 至少 1 项
  if (Array.isArray(g.list["LIST:ROUTES"])) {
    const slugs = g.list["LIST:ROUTES"]
      .map((x: any) => toSlug(String(x)))
      .filter((s: string) => /^[a-z][a-z0-9_-]*$/.test(s));
    g.list["LIST:ROUTES"] = slugs.length ? slugs : ["home"];
  }

  // 3) IF:* 布尔化
  if (g.if && typeof g.if === "object") {
    for (const k of Object.keys(g.if)) {
      g.if[k] = toBool(g.if[k]);
    }
  }

  // 4) Gradle 非空回填 + 逐项过滤
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

/* =========================================================
 * Small utils
 * =======================================================*/

function hasNonEmpty(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function padMin(s: string, n: number) {
  if (s.length >= n) return s;
  return s + ".".repeat(n - s.length);
}

function normalizeThemeColors(v: any): string {
  // 已经是对象 → 直接 JSON.stringify
  if (v && typeof v === "object") {
    const primary = pickColor(v.primary);
    const secondary = pickColor(v.secondary);
    return JSON.stringify({ primary, secondary });
  }
  // 字符串 → 尝试 JSON 或 "#RRGGBB,#RRGGBB"
  const s = String(v ?? "").trim();
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
  return JSON.stringify({ primary: "#7C3AED", secondary: "#10B981" });
}

function pickColor(c: any): string {
  const m = String(c ?? "").match(/^#([0-9a-fA-F]{6})$/);
  return m ? `#${m[1]}` : "#7C3AED";
}

function toSlug(s: string): string {
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
  const ascii = s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return /^[a-z]/.test(ascii) ? ascii : "page";
}

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
