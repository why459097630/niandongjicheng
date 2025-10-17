import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/**
 * 方案B：一次 LLM → 本地 Phase‑2 校验与修复（内联实现）
 * - 新增文件：lib/ndjc/rules/ndjc-rules.json
 * - 修改点：
 *   1) 生成 SKELETON（不带默认值），要求 LLM 严格按骨架返回
 *   2) 本地 Phase‑2：读取 rules/ndjc-rules.json + registry 的约束，验证&修复
 *   3) 失败重试：按上轮 report 做定点反馈（最多 2 次）
 *   4) 后续只使用修复后的 anchors（contractDoc 中体现）
 */

/** ---------------- types ---------------- */
type AnchorGroup = "text" | "block" | "list" | "if" | "hook" | "gradle" | "resources";

// 规则文件（lib/ndjc/rules/ndjc-rules.json）
interface NdjcRules {
  placeholders: string[];                 // 禁止的占位符（如 "__NDJC_PLACEHOLDER__", "N/A" 等）
  forbiddenChars: string[];               // 全局禁止字符（对 files 内容不生效）
  validation: {
    topLevelOrder: string[];              // ["metadata","anchorsGrouped","files"]（用于 Phase‑2 自检）
    groupsOrder: string[];                // ["text","block","list","if","hook","gradle"]（用于 Phase‑2 自检）
    minLen?: Record<string, number>;      // 按 FQ key："block.HOME_HEADER": 30
    enums?: Record<string, string[]>;     // 按 FQ key
    regex?: Record<string, string>;       // 按 FQ key
    listItemRegex?: Record<string, string>; // 按 FQ key（list）
    listMinItems?: Record<string, number>;  // 按 FQ key
    booleans?: string[];                  // 必须是 boolean 的 FQ key
  };
  normalize?: {
    localeMap?: Record<string, string>;   // 例如 {"zh-CN":"zh-rCN"}
    coerceBooleanStrings?: boolean;       // "true"/"false" → boolean
  };
  fix_table: {
    defaults: Record<string, any>;        // FQ key 的兜底值
    listDefaults?: Record<string, any[]>; // FQ list key 的兜底数组
    gradleDefaults?: {
      'gradle.resConfigs'?: string[];
      'gradle.permissions'?: string[];
    };
    fallbackByGroup?: {
      text?: string; block?: string; list?: string[]; if?: Record<string, string | boolean>; hook?: Record<string, string>;
    };
    padTextMinLen?: number;               // 文本默认最小长度（无专门配置时使用）
  };
}

// registry（保持你的原类型）
interface Registry {
  template: string;
  schemaVersion?: string;
  text: string[]; block: string[]; list: string[]; if: string[]; hook: string[]; resources?: string[];
  aliases?: Record<string, string>;
  required?: Partial<Record<Exclude<AnchorGroup, 'gradle' | 'resources'> | 'gradle', string[]>> & { gradle?: string[] };
  defaults?: any;
  placeholders?: Partial<Record<Exclude<AnchorGroup, 'gradle'>, Record<string, any>>> & { gradle?: { applicationId?: string; resConfigs?: string[]; permissions?: string[] } };
  valueFormat?: {
    text?: Record<string, { regex?: string; enum?: string[]; minLen?: number; maxLen?: number }>;
    block?: Record<string, { maxLen?: number; minLen?: number }>;
    list?: Record<string, { itemRegex?: string; minItems?: number; maxItems?: number }>;
    if?: Record<string, {}>;
    hook?: Record<string, {}>;
    resources?: Record<string, { pattern?: string }>;
    gradle?: {
      applicationId?: { regex?: string };
      resConfigs?: { itemRegex?: string };
      permissions?: { itemRegex?: string };
    };
  };
}

export type OrchestrateInput = NdjcRequest & {
  requirement?: string;
  allowCompanions?: boolean;
  appName?: string; homeTitle?: string; mainButtonText?: string; packageId?: string; packageName?: string;
  permissions?: string[]; locales?: string[]; intentHost?: string | null;
  resConfigs?: string; proguardExtra?: string; packagingRules?: string;
  _companions?: { path: string; content: string; overwrite?: boolean; kind?: "kotlin"|"xml"|"json"|"md"|"txt" }[];
};

export type OrchestrateOutput = {
  template: string;
  mode: "B";
  allowCompanions: boolean;
  appName: string; homeTitle: string; mainButtonText: string; packageId: string;
  locales: string[]; resConfigs?: string; proguardExtra?: string; packagingRules?: string;
  permissionsXml?: string; intentFiltersXml?: string; themeOverridesXml?: string;
  companions: { path: string; content: string; overwrite?: boolean; kind?: string }[];
  _trace?: any;
};

/** ---------------- helpers ---------------- */
const ROOT = process.cwd();
const PH_TEXT = "__NDJC_PLACEHOLDER__";
const PH_LIST = [PH_TEXT];

function ensurePackageId(input?: string, fallback = "com.example.ndjc") {
  let v = (input || "").trim();
  if (!v) return fallback;
  v = v.replace(/[^a-z0-9_.]+/gi, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
  if (!v) return fallback;
  return v.toLowerCase();
}

function mkPermissionsXml(perms?: string[]) {
  const list = (perms || []).map((p) => (p || "").trim()).filter(Boolean);
  if (!list.length) return undefined;
  return list.map((p) => `<uses-permission android:name="${p}"/>`).join("\n");
}
function mkIntentFiltersXml(host?: string | null) {
  const h = (host || "").trim();
  if (!h) return undefined;
  return `<intent-filter>\n  <action android:name="android.intent.action.VIEW"/>\n  <category android:name="android.intent.category.DEFAULT"/>\n  <category android:name="android.intent.category.BROWSABLE"/>\n  <data android:scheme="https" android:host="${h}"/>\n</intent-filter>`;
}

function normalizeLocales(locales?: string[]) {
  const arr = (locales || []).map((s) => (s || "").trim()).filter(Boolean);
  return arr.length ? arr : ["en"];
}
function localesToResConfigs(locales: string[]) { return locales.join(","); }

function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  try { return JSON.parse(raw); } catch { return null; }
}

function toUnixPath(p: string) { return (p || "").replace(/^[\\/]+/, "").replace(/\\/g, "/").replace(/\/+/g, "/"); }
function sanitizeCompanions(list?: any[]) {
  const src = Array.isArray(list) ? list : [];
  const out: any[] = [];
  for (const it of src) {
    if (!it || typeof it.path !== "string") continue;
    const rel = toUnixPath(it.path);
    if (!rel || rel.startsWith("../") || rel.includes("..%2f")) continue;
    out.push({ path: rel, content: typeof it.content === "string" ? it.content : "", overwrite: !!it.overwrite, kind: it.kind || "txt" });
  }
  return out;
}

async function readTextAndHash(filePath: string) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const raw = await fs.readFile(abs, "utf8");
  const sha = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { abs, raw, sha, size: Buffer.byteLength(raw) };
}

async function loadRegistry(): Promise<Registry> {
  const hint = process.env.NDJC_REGISTRY_FILE || path.join(ROOT, "lib/ndjc/anchors/registry.circle-basic.json");
  const buf = await fs.readFile(hint, "utf8");
  const json = JSON.parse(buf) as Registry;
  json.placeholders ??= { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} } as any;
  json.valueFormat ??= { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} };
  return json;
}

async function loadRules(): Promise<NdjcRules> {
  const hint = process.env.NDJC_RULES_FILE || path.join(ROOT, "lib/ndjc/rules/ndjc-rules.json");
  const buf = await fs.readFile(hint, "utf8");
  return JSON.parse(buf) as NdjcRules;
}

async function loadSystemPrompt() {
  const hint = process.env.NDJC_PROMPT_SYSTEM_FILE || path.join(ROOT, "lib/ndjc/prompts/contract_v1.en.json");
  const { abs, raw, sha, size } = await readTextAndHash(hint);
  let text = raw; try { const maybe = JSON.parse(raw); if (maybe?.system) text = maybe.system; } catch {}
  return { path: abs, text, sha, size };
}
async function loadRetryPrompt() {
  const hint = process.env.NDJC_PROMPT_RETRY_FILE || path.join(ROOT, "lib/ndjc/prompts/contract_v1.retry.en.txt");
  try { const { abs, raw, sha, size } = await readTextAndHash(hint); return { path: abs, text: raw, sha, size }; }
  catch { return { path: hint, text: "", sha: "", size: 0 }; }
}

/** ----- registry helpers ----- */
function pickWhitelist(group: AnchorGroup, reg: Registry): Set<string> {
  switch (group) {
    case "text": return new Set(reg.text || []);
    case "block": return new Set(reg.block || []);
    case "list": return new Set(reg.list || []);
    case "if": return new Set(reg.if || []);
    case "hook": return new Set(reg.hook || []);
    case "resources": return new Set(reg.resources || []);
    case "gradle": return new Set(["applicationId", "resConfigs", "permissions"]);
  }
}
function placeholderFor(group: AnchorGroup, key: string, reg: Registry): any {
  const ph: any = reg.placeholders || {};
  const g = ph[group] || {};
  if (g[key] != null) return g[key];
  if (group === "list" || group === "gradle") return PH_LIST;
  if (group === "if") return false;
  return PH_TEXT;
}

function containsAngleBrackets(v: any) { if (v == null) return false; return /[<>]/.test(String(v)); }

/** 合并 registry 与 rules 的格式约束（rules 优先） */
function getConstraint(group: AnchorGroup, key: string, reg: Registry, rules: NdjcRules) {
  const FQ = `${group}.${key}`;
  const vf = (reg.valueFormat || {}) as any;
  const base = (vf[group]?.[key]) || {};
  const merged: any = { ...base };
  // 从 rules.validation 合并
  if (rules.validation.regex?.[FQ]) merged.regex = rules.validation.regex[FQ];
  if (rules.validation.enums?.[FQ]) merged.enum = rules.validation.enums[FQ];
  if (rules.validation.minLen?.[FQ]) merged.minLen = rules.validation.minLen[FQ];
  if (group === 'list') {
    if (rules.validation.listItemRegex?.[FQ]) merged.itemRegex = rules.validation.listItemRegex[FQ];
    if (rules.validation.listMinItems?.[FQ]) merged.minItems = rules.validation.listMinItems[FQ];
  }
  // gradle.applicationId / resConfigs / permissions
  if (group === 'gradle' && key === 'applicationId' && rules.validation.regex?.[FQ]) merged.regex = rules.validation.regex[FQ];
  return merged;
}

function validateValue(group: AnchorGroup, key: string, val: any, reg: Registry, rules: NdjcRules): { ok: boolean; reason?: string } {
  const c = getConstraint(group, key, reg, rules);

  // 全局字符串校验
  if (group === "text" || group === "block" || group === "hook" || group === "resources") {
    const s = String(val ?? "");
    if (!s.length) return { ok: false, reason: "empty" };
    if (containsAngleBrackets(s)) return { ok: false, reason: "angle_brackets" };
    if (rules.forbiddenChars?.some((ch) => s.includes(ch))) return { ok: false, reason: "forbidden_char" };
    if (c.minLen && s.length < c.minLen) return { ok: false, reason: `too_short(<${c.minLen})` };
    if (c.maxLen && s.length > c.maxLen) return { ok: false, reason: `too_long(>${c.maxLen})` };
    if (c.enum && Array.isArray(c.enum) && !c.enum.includes(s)) return { ok: false, reason: "enum" };
    if (c.regex && !(new RegExp(c.regex).test(s))) return { ok: false, reason: "regex" };
    return { ok: true };
  }
  if (group === "list") {
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return { ok: false, reason: "empty_list" };
    if (c.minItems && arr.length < c.minItems) return { ok: false, reason: "minItems" };
    if (c.maxItems && arr.length > c.maxItems) return { ok: false, reason: "maxItems" };
    if (c.itemRegex) {
      const re = new RegExp(c.itemRegex);
      for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
    }
    return { ok: true };
  }
  if (group === "if") {
    const t = typeof val === 'string' && rules.normalize?.coerceBooleanStrings ? (val === 'true' ? true : val === 'false' ? false : val) : val;
    return { ok: typeof t === "boolean" };
  }
  if (group === "gradle") {
    if (key === "applicationId") {
      const s = String(val ?? "");
      const re = new RegExp((getConstraint('gradle','applicationId',reg,rules).regex) || ".*");
      return { ok: re.test(s) };
    }
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return { ok: false, reason: "empty_list" };
    const reStr = getConstraint('gradle', key as any, reg, rules).itemRegex;
    if (reStr) {
      const re = new RegExp(reStr);
      for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
    }
    return { ok: true };
  }
  return { ok: true };
}

function applyWhitelistAndAliases(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };
  const groups: AnchorGroup[] = ["text", "block", "list", "if", "hook"];
  const tryAssign = (dict: any, key: string, val: any) => {
    if (key.startsWith("TEXT:")) dict.text[key.replace(/^TEXT:/, "")] = String(val ?? "");
    else if (key.startsWith("BLOCK:")) dict.block[key.replace(/^BLOCK:/, "")] = String(val ?? "");
    else if (key.startsWith("LIST:")) dict.list[key.replace(/^LIST:/, "")] = Array.isArray(val) ? val.map(String) : (val == null ? [] : [String(val)]);
    else if (key.startsWith("IF:")) dict.if[key.replace(/^IF:/, "")] = !!val;
    else if (key.startsWith("HOOK:")) dict.hook[key.replace(/^HOOK:/, "")] = Array.isArray(val) ? val.join("\n") : String(val ?? "");
  };
  const from = raw || {};
  for (const g of groups) {
    const m = from[g] || {};
    for (const [k, v] of Object.entries(m)) tryAssign(out, k, v);
  }
  if (from.gradle && typeof from.gradle === "object") out.gradle = { ...from.gradle };
  (['text','block','list','if','hook'] as const).forEach((g) => {
    const allow = pickWhitelist(g, reg);
    out[g] = Object.fromEntries(Object.entries(out[g]).filter(([k]) => allow.has(k)));
  });
  return out;
}

function ensureMinLen(text: string, min: number, appName = 'NDJC App') {
  if (typeof text !== 'string') text = String(text ?? '');
  if (text.length >= min) return text;
  const pad = ` — ${appName} provides seamless browsing, uploads, and rich content for Android.`;
  let out = text; while (out.length < min) out += pad; return out.slice(0, Math.max(min, out.length));
}

function enforceRequiredAndFormats(doc: any, reg: Registry, rules: NdjcRules) {
  const req = reg.required || {};
  const report = { missing: [] as string[], invalid: [] as string[] };
  doc.text ||= {}; doc.block ||= {}; doc.list ||= {}; doc.if ||= {}; doc.hook ||= {}; doc.gradle ||= {};

  const usePH = (g: AnchorGroup, k: string) => placeholderFor(g, k, reg);

  for (const k of (req.text || [])) { let v = doc.text[k]; if (v == null || v === "" || containsAngleBrackets(v)) { v = usePH("text", k); report.missing.push(`text:${k}`);} doc.text[k] = v; }
  for (const k of (req.block || [])) { let v = doc.block[k]; if (v == null || v === "" || containsAngleBrackets(v)) { v = usePH("block", k); report.missing.push(`block:${k}`);} doc.block[k] = v; }
  for (const k of (req.list || []))  { let v = doc.list[k]; if (!Array.isArray(v) || !v.length) { v = usePH("list", k); report.missing.push(`list:${k}`);} doc.list[k] = v; }
  for (const k of (req.if || []))    { let v = doc.if[k];   if (typeof v !== 'boolean') { v = usePH("if", k); report.missing.push(`if:${k}`);} doc.if[k] = v; }
  for (const k of (req.hook || []))  { let v = doc.hook[k]; if (v == null || v === "" || containsAngleBrackets(v)) { v = usePH("hook", k); report.missing.push(`hook:${k}`);} doc.hook[k] = v; }
  for (const k of (req.gradle || [])) {
    if (k === 'applicationId') { let appId = doc.gradle.applicationId || doc.text?.["NDJC:PACKAGE_NAME"] || usePH('gradle','applicationId'); appId = ensurePackageId(appId, 'com.example.ndjc'); doc.gradle.applicationId = appId; if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId; }
    else if (k === 'resConfigs') { if (!Array.isArray(doc.gradle.resConfigs) || !doc.gradle.resConfigs.length) doc.gradle.resConfigs = usePH('gradle','resConfigs'); }
    else if (k === 'permissions') { if (!Array.isArray(doc.gradle.permissions) || !doc.gradle.permissions.length) doc.gradle.permissions = usePH('gradle','permissions'); }
  }

  (['text','block','list','if','hook'] as const).forEach((g) => {
    const allow = pickWhitelist(g, reg);
    for (const key of Object.keys(doc[g])) {
      if (!allow.has(key)) { delete doc[g][key]; continue; }
      const val = doc[g][key];
      const ok = validateValue(g, key, val, reg, rules);
      if (!ok.ok) { report.invalid.push(`${g}:${key} (${ok.reason})`); doc[g][key] = placeholderFor(g, key, reg); }
      // 文本与区块最小长度兜底
      const FQ = `${g}.${key}`; const need = rules.validation.minLen?.[FQ] ?? (g === 'block' || g === 'text' ? (rules.fix_table.padTextMinLen ?? 30) : 0);
      if ((g === 'block' || g === 'text') && typeof doc[g][key] === 'string' && need > 0 && String(doc[g][key]).length < need) {
        doc[g][key] = ensureMinLen(String(doc[g][key]), need);
      }
    }
  });

  // gradle 额外兜底
  const gradle = doc.gradle || {};
  if (!Array.isArray(gradle.resConfigs) || !gradle.resConfigs.length) gradle.resConfigs = rules.fix_table.gradleDefaults?.['gradle.resConfigs'] ?? ['en'];
  if (rules.normalize?.localeMap && Array.isArray(gradle.resConfigs)) gradle.resConfigs = gradle.resConfigs.map((x: string) => rules.normalize!.localeMap![x] ?? x);
  if (!Array.isArray(gradle.permissions) || !gradle.permissions.length) gradle.permissions = rules.fix_table.gradleDefaults?.['gradle.permissions'] ?? ['android.permission.INTERNET'];
  doc.gradle = gradle;

  return { doc, report };
}

/** ---------------- main orchestrate ---------------- */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const [reg, rules, sysPrompt, rtyPrompt] = await Promise.all([
    loadRegistry(),
    loadRules(),
    loadSystemPrompt(),
    loadRetryPrompt(),
  ]);

  // 种子
  let appName = input.appName || 'NDJC App';
  let homeTitle = input.homeTitle || 'Home';
  let mainButtonText = input.mainButtonText || 'Start';
  let packageId = ensurePackageId(input.packageId || input.packageName || 'com.example.ndjc');
  let permissions = input.permissions || ['android.permission.INTERNET'];
  let locales = normalizeLocales(input.locales);
  let companions = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const allowCompanions = !!input.allowCompanions;
  const template = (reg.template || 'circle-basic');

  const _trace: any = { retries: [], source: { registry_file: process.env.NDJC_REGISTRY_FILE || path.join(ROOT, 'lib/ndjc/anchors/registry.circle-basic.json'), rules_file: process.env.NDJC_RULES_FILE || path.join(ROOT, 'lib/ndjc/rules/ndjc-rules.json'), prompt_file: sysPrompt.path, retry_file: rtyPrompt.path } };

  // ① 生成骨架（不带默认值）
  const skeleton = {
    metadata: { template, appName, packageId, mode: 'B' as const },
    anchors: {
      text: Object.fromEntries(reg.text.map(k => [k, PH_TEXT])),
      block: Object.fromEntries(reg.block.map(k => [k, PH_TEXT])),
      list: Object.fromEntries(reg.list.map(k => [k, PH_LIST])),
      if: Object.fromEntries(reg.if.map(k => [k, false])),
      hook: Object.fromEntries(reg.hook.map(k => [k, PH_TEXT])),
      gradle: { applicationId: packageId, resConfigs: locales, permissions },
    },
    files: [] as any[],
  };

  // ② user
  const baseUser = [
    'Return STRICT JSON only. Mirror SKELETON exactly (keys/structure/types). Do not add/remove/rename/reorder keys.',
    'All anchors are REQUIRED. If not applicable, use placeholders (strings use "__NDJC_PLACEHOLDER__"; lists use ["__NDJC_PLACEHOLDER__"]; booleans use false).',
    'Never output empty string/array/object. Never include "<" or ">" in any string.',
    'Do not change metadata. Do not invent anchors outside SKELETON.',
    'SKELETON:',
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``),
  ].filter(Boolean).join('\n');

  const maxRetries = 2; let parsed: any = null; let lastText = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [ { role: 'system', content: sysPrompt.text || 'Return JSON only.' }, { role: 'user', content: baseUser } ];
      if (attempt > 0) {
        if (lastText) msgs.push({ role: 'assistant', content: lastText });
        const prev = _trace.retries?.[attempt - 1]?.report;
        const bullets: string[] = [];
        if (prev) {
          if (prev.missing?.length) { bullets.push('Missing required anchors:'); bullets.push(...prev.missing.map((k: string) => `- ${k}`)); }
          if (prev.invalid?.length) { bullets.push('Invalid anchors (format/regex/angle brackets/empty):'); bullets.push(...prev.invalid.map((k: string) => `- ${k}`)); }
        }
        msgs.push({ role: 'user', content: [(rtyPrompt.text || 'Fix mistakes and keep exact SKELETON keys.'), bullets.join('\n')].filter(Boolean).join('\n\n') });
      }
      const r = await callGroqChat(msgs, { temperature: 0 });
      const text = typeof r === 'string' ? r : (r as any)?.text ?? '';
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      // 归一化 + 白名单
      const normalized = applyWhitelistAndAliases(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);

      // Phase‑2：校验与修复
      const { doc, report } = enforceRequiredAndFormats({ ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} }, reg, rules);
      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: report.invalid.length === 0 };
      _trace.retries.push({ attempt, ok: parsed._ok, report });
      if (parsed._ok) break;
    } catch (e: any) { _trace.retries.push({ attempt, error: e?.message || String(e) }); }
  }

  // 抽取关键值
  let appName2 = appName, packageId2 = packageId, homeTitle2 = homeTitle, mainButtonText2 = mainButtonText;
  if (parsed?.metadata) { appName2 = parsed.metadata.appName || appName2; packageId2 = ensurePackageId(parsed.metadata.packageId || packageId2, packageId2); }
  const anchorsFinal = parsed?.anchors || {};
  if (anchorsFinal?.text) {
    appName2 = anchorsFinal.text["NDJC:APP_LABEL"] || appName2;
    homeTitle2 = anchorsFinal.text["NDJC:HOME_TITLE"] || homeTitle2;
    mainButtonText2 = anchorsFinal.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText2;
    packageId2 = ensurePackageId(anchorsFinal.text["NDJC:PACKAGE_NAME"] || packageId2, packageId2);
  }
  const gradle = anchorsFinal?.gradle || {};
  if (Array.isArray(gradle.resConfigs)) locales = normalizeLocales(gradle.resConfigs);
  if (Array.isArray(gradle.permissions)) permissions = gradle.permissions;
  if (allowCompanions && Array.isArray(parsed?._raw?.files)) companions = sanitizeCompanions(parsed._raw.files);

  const contractDoc = {
    metadata: { template, appName: appName2, packageId: packageId2, mode: 'B' as const },
    anchors: anchorsFinal,
    files: allowCompanions ? companions : [],
  };
  _trace.rawText = JSON.stringify(contractDoc, null, 2);

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = input.intentHost ? mkIntentFiltersXml(input.intentHost) : undefined;
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const { proguardExtra, packagingRules } = input;

  return {
    template,
    mode: 'B',
    allowCompanions,
    appName: appName2,
    homeTitle: homeTitle2,
    mainButtonText: mainButtonText2,
    packageId: packageId2,
    locales,
    resConfigs,
    proguardExtra,
    packagingRules,
    permissionsXml,
    intentFiltersXml,
    themeOverridesXml,
    companions: allowCompanions ? companions : [],
    _trace,
  };
}
