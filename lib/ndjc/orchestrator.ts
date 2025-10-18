// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

// --- 方案A：静态导入 JSON，随函数一起打包 ---
import registryJson from "@/lib/ndjc/anchors/registry.circle-basic.json";
import rulesJson from "@/lib/ndjc/rules/ndjc-rules.json";

/** ---------------- types ---------------- */
type AnchorGroup = "text" | "block" | "list" | "if" | "hook" | "gradle";

type Registry = {
  template: string;
  schemaVersion?: string;
  text: string[];
  block: string[];
  list: string[];
  if: string[];
  hook: string[];
  aliases?: Record<string, string>;
  required?: Partial<Record<AnchorGroup, string[]>>;
  placeholders?: {
    text?: Record<string, string>;
    block?: Record<string, string>;
    list?: Record<string, string[]>;
    if?: Record<string, boolean>;
    hook?: Record<string, string>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };
  valueFormat?: {
    text?: Record<string, { regex?: string; enum?: string[]; minLen?: number; maxLen?: number }>;
    block?: Record<string, { minLen?: number; maxLen?: number }>;
    list?: Record<string, { itemRegex?: string; minItems?: number; maxItems?: number }>;
    if?: Record<string, {}>;
    hook?: Record<string, { minLen?: number; maxLen?: number }>;
    gradle?: {
      applicationId?: { regex?: string };
      resConfigs?: { itemRegex?: string; minItems?: number };
      permissions?: { itemRegex?: string; minItems?: number };
    };
  };
};

type Companion = {
  path: string;
  content: string;
  overwrite?: boolean;
  kind?: "kotlin" | "xml" | "json" | "md" | "txt";
};

export type OrchestrateInput = NdjcRequest & {
  requirement?: string;
  allowCompanions?: boolean; // 方案B默认 false
  appName?: string;
  homeTitle?: string;
  mainButtonText?: string;
  packageId?: string;
  packageName?: string;
  permissions?: string[];
  locales?: string[];
  intentHost?: string | null;
  _companions?: Companion[];
  contract?: "v1" | "legacy";
};

export type OrchestrateOutput = {
  template: string;
  mode: "B";
  allowCompanions: boolean;

  appName: string;
  homeTitle: string;
  mainButtonText: string;
  packageId: string;

  locales: string[];
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;

  permissionsXml?: string;
  intentFiltersXml?: string;
  themeOverridesXml?: string;

  companions: Companion[];
  _trace?: any | null;

  /** 👇 新增：给 route.ts 的 precheck 使用 */
  raw?: string;                 // LLM 原文字符串
  contract?: any;               // 对象态 Contract v1
  data?: any;                   // 等价别名
  contractV1?: any;             // 等价别名
  parsed?: any;                 // 等价别名
};

/** ---------------- helpers ---------------- */
const ROOT = process.cwd();
const PH_TEXT = "__NDJC_PLACEHOLDER__";
const PH_LIST = [PH_TEXT];

const PKG_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const LOCALE_ITEM = /^[a-z]{2,3}(-[A-Z]{2,3})?$/;
const PERM_ITEM = /^android\.permission\.[A-Z_]+$/;

function toUnixPath(p: string) {
  return (p || "").replace(/^[\\/]+/, "").replace(/\\/g, "/").replace(/\/+/g, "/");
}
function ensurePackageId(input?: string, fallback = "com.example.ndjc") {
  let v = (input || "").trim();
  if (!v) return fallback;
  v = v.replace(/[^a-z0-9_.]+/gi, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".").toLowerCase();
  if (!PKG_REGEX.test(v)) return fallback;
  return v;
}
function mkPermissionsXml(perms?: string[]) {
  const list = (perms || []).map((p) => (p || "").trim()).filter(Boolean);
  if (!list.length) return undefined;
  return list.map((p) => `<uses-permission android:name="${p}"/>`).join("\n");
}
function mkIntentFiltersXml(host?: string | null) {
  const h = (host || "").trim();
  if (!h) return undefined;
  return `<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="${h}"/>
</intent-filter>`;
}
function normalizeLocales(locales?: string[]) {
  const arr = (locales || []).map((s) => (s || "").trim()).filter(Boolean);
  return arr.length ? arr : ["en"];
}
function localesToResConfigs(locales: string[]) {
  return locales.join(",");
}
async function readText(filePath: string) {
  const safe = filePath.replace(/^@\/+/, "");
  const abs = path.isAbsolute(safe) ? safe : path.join(ROOT, safe);
  return fs.readFile(abs, "utf8");
}
async function readTextAndHash(filePath: string) {
  const safe = filePath.replace(/^@\/+/, "");
  const abs = path.isAbsolute(safe) ? safe : path.join(ROOT, safe);
  const raw = await fs.readFile(abs, "utf8");
  const sha = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { abs, raw, sha, size: Buffer.byteLength(raw) };
}
function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  try { return JSON.parse(raw); } catch { return null; }
}

/** ---------------- load registry & rules & prompts ---------------- */
async function loadRegistry(): Promise<Registry> {
  if (registryJson) {
    const j = JSON.parse(JSON.stringify(registryJson)) as Registry;
    j.aliases ||= {};
    j.required ||= {};
    j.placeholders ||= {};
    j.valueFormat ||= {};
    return j;
  }
  const hint = (process.env.NDJC_REGISTRY_FILE || "lib/ndjc/anchors/registry.circle-basic.json").replace(/^@\/+/, "");
  const raw = await readText(hint);
  const json = JSON.parse(raw) as Registry;
  json.aliases ||= {};
  json.required ||= {};
  json.placeholders ||= {};
  json.valueFormat ||= {};
  return json;
}

type Rules = {
  global?: {
    forbidAngles?: boolean;
    forbidPlaceholders?: boolean;
  };
  text?: Record<string, { minLen?: number; regex?: string }>;
  block?: Record<string, { minLen?: number }>;
  list?: Record<string, { minItems?: number; itemRegex?: string }>;
  gradle?: {
    applicationId?: { regex: string };
    resConfigs?: { minItems?: number; itemRegex?: string };
    permissions?: { minItems?: number; itemRegex?: string };
  };
  fixes?: {
    onInvalidPackageUseApplicationId?: boolean;
  };
};

async function loadRules(): Promise<Rules> {
  if (rulesJson) {
    return JSON.parse(JSON.stringify(rulesJson)) as Rules;
  }
  const hint = (process.env.NDJC_RULES_FILE || "lib/ndjc/rules/ndjc-rules.json").replace(/^@\/+/, "");
  try {
    const raw = await readText(hint);
    return JSON.parse(raw) as Rules;
  } catch {
    return {
      global: { forbidAngles: true, forbidPlaceholders: true },
      gradle: {
        applicationId: { regex: PKG_REGEX.source },
        resConfigs: { minItems: 1, itemRegex: LOCALE_ITEM.source },
        permissions: { minItems: 1, itemRegex: PERM_ITEM.source },
      },
      fixes: { onInvalidPackageUseApplicationId: true },
    };
  }
}

async function loadSystemPrompt() {
  const hint = (process.env.NDJC_PROMPT_SYSTEM_FILE || "lib/ndjc/prompts/contract_v1.en.json").replace(/^@\/+/, "");
  try {
    const { abs, raw, sha, size } = await readTextAndHash(hint);
    let text = raw;
    try { const maybe = JSON.parse(raw); if (maybe?.system) text = String(maybe.system); } catch {}
    return { path: abs, text, sha, size };
  } catch {
    return { path: hint, text: "Return JSON only.", sha: "", size: 0 };
  }
}
async function loadRetryPrompt() {
  const hint = (process.env.NDJC_PROMPT_RETRY_FILE || "lib/ndjc/prompts/contract_v1.retry.en.txt").replace(/^@\/+/, "");
  try {
    const { abs, raw, sha, size } = await readTextAndHash(hint);
    return { path: abs, text: raw, sha, size };
  } catch {
    return { path: hint, text: "Fix mistakes and return JSON only.", sha: "", size: 0 };
  }
}

/** ---------------- normalize & whitelist ---------------- */
function pickWhitelist(group: AnchorGroup, reg: Registry): Set<string> {
  switch (group) {
    case "text": return new Set(reg.text || []);
    case "block": return new Set(reg.block || []);
    case "list": return new Set(reg.list || []);
    case "if": return new Set(reg.if || []);
    case "hook": return new Set(reg.hook || []);
    case "gradle": return new Set(["applicationId", "resConfigs", "permissions"]);
  }
}
const PH = {
  for(group: AnchorGroup, key: string, reg: Registry): any {
    const ph = reg.placeholders || {};
    const g = (ph as any)[group] || {};
    if ((g as any)[key] != null) return (g as any)[key];
    if (group === "list" || group === "gradle") return PH_LIST;
    if (group === "if") return false;
    return PH_TEXT;
  }
};
function normalizeKey(k: string) {
  const s = (k || "").trim();
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(s)) return s;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^DEBUG_|^BUILD_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(s)) return `BLOCK:${s}`;
  if (/^ROUTES$|FIELDS$|STRINGS$|PATTERNS$|STYLES$|PACKAGING|PROGUARD/i.test(s)) return `LIST:${s}`;
  if (/^NDJC:/.test(s)) return `TEXT:${s}`;
  return s;
}
function applyWhitelist(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };
  const src = raw || {};
  const groups: AnchorGroup[] = ["text", "block", "list", "if", "hook"];
  const put = (dict: any, key: string, val: any) => {
    if (key.startsWith("TEXT:")) dict.text[key.replace(/^TEXT:/, "")] = String(val ?? "");
    else if (key.startsWith("BLOCK:")) dict.block[key.replace(/^BLOCK:/, "")] = String(val ?? "");
    else if (key.startsWith("LIST:")) dict.list[key.replace(/^LIST:/, "")] = Array.isArray(val) ? val.map(String) : (val == null ? [] : [String(val)]);
    else if (key.startsWith("IF:")) dict.if[key.replace(/^IF:/, "")] = !!val;
    else if (key.startsWith("HOOK:")) dict.hook[key.replace(/^HOOK:/, "")] = String(val ?? "");
  };
  for (const g of groups) {
    const m = src[g] || {};
    for (const [k, v] of Object.entries(m)) put(out, normalizeKey(k), v);
  }
  if (src.gradle && typeof src.gradle === "object") out.gradle = { ...src.gradle };

  (["text","block","list","if","hook"] as AnchorGroup[]).forEach((g) => {
    const allow = pickWhitelist(g, reg);
    out[g] = Object.fromEntries(Object.entries(out[g]).filter(([k]) => allow.has(k)));
  });
  return out;
}

/** ---------------- Phase-2: 校验与修复（含 Manifest 守护） ---------------- */
function validateByRules(
  doc: any,
  reg: Registry,
  rules: Rules,
  seed: { applicationId: string; locales: string[]; permissions: string[] }
) {
  const report = { missing: [] as string[], invalid: [] as string[], fixed: [] as string[] };

  // required
  const req = reg.required || {};
  for (const g of ["text","block","list","if","hook"] as AnchorGroup[]) {
    const need = (req as any)[g] as string[] | undefined;
    if (!need) continue;
    doc[g] ||= {};
    for (const k of need) {
      const v = doc[g][k];
      if (g === "list") {
        if (!Array.isArray(v) || v.length === 0) { doc[g][k] = PH.for("list", k, reg); report.missing.push(`${g}:${k}`); }
      } else if (g === "if") {
        if (typeof v !== "boolean") { doc[g][k] = false; report.missing.push(`${g}:${k}`); }
      } else {
        if (v == null || String(v) === "") { doc[g][k] = PH.for(g, k, reg); report.missing.push(`${g}:${k}`); }
      }
    }
  }

  const forbidAngles = rules.global?.forbidAngles !== false;
  const forbidPH = rules.global?.forbidPlaceholders !== false;
  const reject = (s: string) =>
    (forbidAngles && /[<>]/.test(s)) || (forbidPH && s.includes(PH_TEXT));

  const checkTBH = (g: "text" | "block" | "hook") => {
    const fmt = (rules as any)[g] || {};
    for (const [k, v] of Object.entries<string>(doc[g] || {})) {
      let s = String(v ?? "");
      if (!s.length || reject(s)) { doc[g][k] = PH.for(g, k, reg); report.invalid.push(`${g}:${k}`); continue; }
      const rule = fmt[k];
      if (rule?.minLen && s.length < rule.minLen) { s = s.padEnd(rule.minLen, "."); doc[g][k] = s; report.fixed.push(`${g}:${k}(minLen)`); }
      if (rule?.regex && !(new RegExp(rule.regex)).test(s)) { report.invalid.push(`${g}:${k}(regex)`); }
    }
  };
  checkTBH("text"); checkTBH("block"); checkTBH("hook");

  // list
  for (const [k, arr] of Object.entries<any[]>(doc.list || {})) {
    const rule = rules.list?.[k];
    let a = Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
    if (!a.length && rule?.minItems) a = Array.from({ length: rule.minItems }, () => PH_TEXT);
    if (rule?.itemRegex) {
      const re = new RegExp(rule.itemRegex);
      if (!a.every((x) => re.test(x))) report.invalid.push(`list:${k}(itemRegex)`);
    }
    doc.list[k] = a;
  }

  // gradle
  doc.gradle ||= {};
  // applicationId
  {
    let appId = String(doc.gradle.applicationId ?? doc.text?.["NDJC:PACKAGE_NAME"] ?? "");
    appId = ensurePackageId(appId || seed.applicationId, seed.applicationId);
    if (!PKG_REGEX.test(appId)) { appId = seed.applicationId; report.fixed.push("gradle:applicationId(fallback)"); }
    doc.gradle.applicationId = appId;
    if (!PKG_REGEX.test(String(doc.text?.["NDJC:PACKAGE_NAME"]))) {
      doc.text ||= {}; doc.text["NDJC:PACKAGE_NAME"] = appId; report.fixed.push("text:NDJC:PACKAGE_NAME(sync)");
    }
  }
  // resConfigs
  {
    let arr: string[] = Array.isArray(doc.gradle.resConfigs) ? doc.gradle.resConfigs.map(String) : [];
    const re = new RegExp(rules.gradle?.resConfigs?.itemRegex || LOCALE_ITEM.source);
    arr = arr.filter((x) => re.test(x));
    if (!arr.length) arr = ["en"];
    doc.gradle.resConfigs = arr;
  }
  // permissions
  {
    let arr: string[] = Array.isArray(doc.gradle.permissions) ? doc.gradle.permissions.map(String) : [];
    const re = new RegExp(rules.gradle?.permissions?.itemRegex || PERM_ITEM.source);
    arr = arr.filter((x) => re.test(x));
    if (!arr.length) arr = ["android.permission.INTERNET"];
    doc.gradle.permissions = arr;
  }

  return { doc, report };
}

function fixManifestIfNeeded(files: Companion[], applicationId: string, _rules: Rules): Companion[] {
  if (!files?.length) return files || [];
  const out: Companion[] = [];
  const rePkg = /\bpackage\s*=\s*"([^"]*)"/;
  for (const f of files) {
    const rel = toUnixPath(f.path || "");
    if (!rel) continue;
    if (rel.endsWith("AndroidManifest.xml")) {
      let content = f.content || "";
      if (content.includes(PH_TEXT)) content = content.replaceAll(PH_TEXT, "");
      const m = content.match(rePkg);
      if (m) {
        const current = m[1] || "";
        if (!PKG_REGEX.test(current)) content = content.replace(rePkg, `package="${applicationId}"`);
      } else {
        content = content.replace("<manifest", `<manifest package="${applicationId}"`);
      }
      out.push({ ...f, content });
    } else {
      out.push(f);
    }
  }
  return out;
}

/** ---------------- main orchestrate ---------------- */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg = await loadRegistry();
  const rules = await loadRules();
  const sysPrompt = await loadSystemPrompt();
  const rtyPrompt = await loadRetryPrompt(); // 仅记录到 trace

  // 种子值
  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Home";
  let mainButtonText = input.mainButtonText || "Create";
  let packageId = ensurePackageId(input.packageId || input.packageName, "com.example.ndjc");
  let locales = normalizeLocales(input.locales);
  let permissions = input.permissions?.length ? input.permissions : ["android.permission.INTERNET"];

  const allowCompanions = !!input.allowCompanions && false; // 方案B默认关

  // 1) 构造骨架
  const skeleton = {
    metadata: { template: reg.template || "circle-basic", appName, packageId, mode: "B" as const },
    anchors: {
      text: Object.fromEntries(reg.text.map((k) => {
        if (k === "NDJC:APP_LABEL") return [k, appName];
        if (k === "NDJC:HOME_TITLE") return [k, homeTitle];
        if (k === "NDJC:PRIMARY_BUTTON_TEXT") return [k, mainButtonText];
        if (k === "NDJC:PACKAGE_NAME") return [k, packageId];
        return [k, PH_TEXT];
      })),
      block: Object.fromEntries(reg.block.map((k) => [k, PH_TEXT])),
      list: Object.fromEntries(reg.list.map((k) => [k, PH_LIST])),
      if: Object.fromEntries(reg.if.map((k) => [k, false])),
      hook: Object.fromEntries(reg.hook.map((k) => [k, PH_TEXT])),
      gradle: { applicationId: packageId, resConfigs: locales, permissions }
    },
    files: [] as any[],
  };

  const baseUser =
    [
      "Return STRICT JSON only (no markdown).",
      "Mirror SKELETON exactly (same keys/structure).",
      "All anchors are REQUIRED. If unknown, use placeholders: strings='__NDJC_PLACEHOLDER__', lists=['__NDJC_PLACEHOLDER__'], booleans=false.",
      "No empty string/array/object. No '<' or '>' in any string.",
      "Do not add/remove/rename/reorder keys. Do not change metadata.",
      "SKELETON:",
      JSON.stringify(skeleton, null, 2),
      input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ""
    ].filter(Boolean).join("\n");

  const _trace: any = {
    retries: [],
    source: {
      registry_file: "static-import:lib/ndjc/anchors/registry.circle-basic.json",
      rules_file: "static-import:lib/ndjc/rules/ndjc-rules.json",
      prompt_file: sysPrompt.path,
      retry_file: rtyPrompt.path,
      model: process.env.NDJC_MODEL || "groq",
      mode: "single-call+local-fix"
    }
  };

  // 2) 单次 LLM 调用
  let parsed: any = null;
  let rawText = ""; // 👈 新增：保存 LLM 原文
  try {
    const msgs: any[] = [
      { role: "system", content: sysPrompt.text },
      { role: "user", content: baseUser },
    ];
    const r = await callGroqChat(msgs, { temperature: 0 });

    rawText = typeof r === "string" ? r : (r as any)?.text ?? "";
    _trace.raw_llm_text = rawText; // 👈 新增：trace 里也存一份

    const json = parseJsonSafely(rawText) || {};
    const normalized = applyWhitelist(json?.anchors || json?.anchorsGrouped || {}, reg);

    const { doc, report } = validateByRules(
      { ...normalized, gradle: json?.anchors?.gradle || json?.gradle || {} },
      reg,
      rules,
      { applicationId: packageId, locales, permissions }
    );

    parsed = {
      metadata: json?.metadata || skeleton.metadata,
      anchors: doc,
      files: Array.isArray(json?.files) ? json.files : [],
      _report: report
    };

    _trace.retries.push({ attempt: 0, ok: report.invalid.length === 0, report });
  } catch (e: any) {
    _trace.retries.push({ attempt: 0, error: e?.message || String(e) });
    // 出错则使用 skeleton 继续走后续本地修复
    const { doc } = validateByRules(
      { ...skeleton.anchors },
      reg,
      rules,
      { applicationId: packageId, locales, permissions }
    );
    parsed = { metadata: skeleton.metadata, anchors: doc, files: [], _report: { missing: [], invalid: [], fixed: [] } };
  }

  // 3) 输出及衍生
  const anchors = parsed?.anchors || skeleton.anchors;
  const appId = ensurePackageId(anchors?.gradle?.applicationId || anchors?.text?.["NDJC:PACKAGE_NAME"], packageId);
  anchors.gradle.applicationId = appId;
  anchors.text["NDJC:PACKAGE_NAME"] = appId;

  appName = anchors.text["NDJC:APP_LABEL"] || appName;
  homeTitle = anchors.text["NDJC:HOME_TITLE"] || homeTitle;
  mainButtonText = anchors.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;

  locales = Array.isArray(anchors.gradle.resConfigs) ? anchors.gradle.resConfigs : locales;
  permissions = Array.isArray(anchors.gradle.permissions) ? anchors.gradle.permissions : permissions;

  let companions: Companion[] = [];
  if (allowCompanions && Array.isArray(parsed?.files)) {
    companions = parsed.files.map((f: any) => ({
      path: toUnixPath(String(f?.path || "")),
      content: String(f?.content || ""),
      overwrite: !!f?.overwrite,
      kind: (f?.kind || "txt"),
    })).filter((x: Companion) => x.path);
  }
  companions = fixManifestIfNeeded(companions, appId, rules);

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(input.intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = localesToResConfigs(locales);

  const template = reg.template || "circle-basic";

  // 👇 关键：把 raw 与 对象态 contract 一并返回，供 route.ts 使用
  const contractObject = {
    metadata: parsed?.metadata || skeleton.metadata,
    anchors,
    files: parsed?.files || [],
  };

  const out: OrchestrateOutput = {
    template,
    mode: "B",
    allowCompanions,
    appName,
    homeTitle,
    mainButtonText,
    packageId: appId,
    locales,
    resConfigs,
    permissionsXml,
    intentFiltersXml,
    themeOverridesXml,
    companions,
    _trace,

    // 供 precheck 使用
    raw: rawText,               // LLM 原文
    contract: contractObject,   // 对象态 Contract v1
    data: contractObject,       // 等价别名
    contractV1: contractObject, // 等价别名
    parsed: contractObject,     // 等价别名
  };

  return out;
}
