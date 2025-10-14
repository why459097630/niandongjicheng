// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** ---------------- types ---------------- */
type AnchorGroup = "text" | "block" | "list" | "if" | "hook" | "resources" | "gradle";

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
    resources?: string[];
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

  placeholders?: {
    text?: Record<string, string>;
    block?: Record<string, string>;
    list?: Record<string, string[]>;
    if?: Record<string, boolean>;
    hook?: Record<string, string>;
    resources?: Record<string, string>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };

  valueFormat?: {
    text?: Record<string, { regex?: string; enum?: string[]; minLen?: number; maxLen?: number }>;
    block?: Record<string, { minLen?: number; maxLen?: number; mustContainAny?: string[] }>;
    list?: Record<string, { itemRegex?: string; minItems?: number; maxItems?: number; itemMinLen?: number }>;
    if?: Record<string, {}>;
    hook?: Record<string, { minLen?: number }>;
    resources?: Record<string, { pattern?: string }>;
    gradle?: {
      applicationId?: { regex?: string };
      resConfigs?: { itemRegex?: string };
      permissions?: { itemRegex?: string };
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
  mode?: "A" | "B";
  allowCompanions?: boolean;

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

  _companions?: Companion[];
  developerNotes?: string;

  contract?: "v1" | "legacy";
  contractV1?: boolean;
};

export type OrchestrateOutput = {
  template: "circle-basic" | string;
  mode: "A" | "B";
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
};

/** ---------------- helpers ---------------- */
const ROOT = process.cwd();

// 全局强约束（与 prompts 中一致）
const DENY_PATTERNS = [
  /^__.*__$/i,          // __FOO__
  /\{\{.*\}\}/,         // {{BAR}}
  /placeholder|todo|sample|example|模板|样例/i
];
const BLOCK_MUST_CONTAIN_ANY = ["@Composable", "fun ", "LazyColumn", "Modifier."];
const BLOCK_MIN_LEN = 30;
const HOOK_MIN_LEN = 10;
const LIST_ITEM_MIN_LEN = 2;

// 仅在“合成兜底值”时使用 —— 不是给模型的占位符
function synthesizeSafeValue(group: AnchorGroup, key: string): any {
  if (group === "text") {
    if (key === "NDJC:PACKAGE_NAME") return "com.ndjc.app";
    if (key === "NDJC:APP_LABEL") return "NDJC App";
    if (key === "NDJC:HOME_TITLE") return "Home";
    if (key === "NDJC:PRIMARY_BUTTON_TEXT") return "Create";
    return "ok"; // 合法短字串，避免空
  }
  if (group === "block") {
    return "@Composable fun BlockSafe() { androidx.compose.material3.Text(\"ok\") }";
  }
  if (group === "list") {
    return ["ok"];
  }
  if (group === "if") {
    return false;
  }
  if (group === "hook") {
    return "echo ok";
  }
  if (group === "gradle") {
    if (key === "applicationId") return "com.ndjc.app";
    if (key === "resConfigs") return ["en"];
    if (key === "permissions") return ["android.permission.INTERNET"];
  }
  return "ok";
}

function isEmptyLike(v: any) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

function violatesDeny(v: string) {
  return DENY_PATTERNS.some((re) => re.test(v));
}

function readJsonIfHasSystemField(raw: string) {
  try {
    const maybe = JSON.parse(raw);
    if (maybe && typeof maybe.system === "string") return maybe.system;
  } catch {}
  return raw;
}

async function readTextAndHash(filePath: string) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const raw = await fs.readFile(abs, "utf8");
  const sha = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { abs, raw, sha, size: Buffer.byteLength(raw) };
}

async function loadRegistry(): Promise<Registry | null> {
  const hint =
    process.env.NDJC_REGISTRY_FILE ||
    process.env.REGISTRY_FILE ||
    path.join(ROOT, "lib/ndjc/anchors/registry.circle-basic.json");
  try {
    const buf = await fs.readFile(hint, "utf8");
    const json = JSON.parse(buf) as Registry;
    json.placeholders ??= { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} };
    json.valueFormat ??= { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} };
    console.log(
      `[NDJC:orchestrator] registry loaded: %s (text:%d, block:%d, list:%d, if:%d, hook:%d)`,
      hint,
      json.text?.length ?? 0,
      json.block?.length ?? 0,
      json.list?.length ?? 0,
      json.if?.length ?? 0,
      json.hook?.length ?? 0
    );
    return json;
  } catch (e: any) {
    console.warn(`[NDJC:orchestrator] registry load failed: ${e?.message}`);
    return null;
  }
}

async function loadSystemPrompt() {
  const hint =
    process.env.NDJC_PROMPT_SYSTEM_FILE ||
    path.join(ROOT, "lib/ndjc/prompts/contract_v1.en.json");
  try {
    const { abs, raw, sha, size } = await readTextAndHash(hint);
    const text = readJsonIfHasSystemField(raw);
    console.log(`[NDJC:orchestrator] system prompt loaded: %s (size:%d, sha256:%s)`, abs, size, sha.slice(0, 12));
    return { path: abs, text, sha, size };
  } catch (e: any) {
    console.error(`[NDJC:orchestrator] system prompt load failed: ${e?.message}`);
    return { path: hint, text: "", sha: "", size: 0 };
  }
}

async function loadRetryPrompt() {
  const hint =
    process.env.NDJC_PROMPT_RETRY_FILE ||
    path.join(ROOT, "lib/ndjc/prompts/contract_v1.retry.en.txt");
  try {
    const { abs, raw, sha, size } = await readTextAndHash(hint);
    console.log(`[NDJC:orchestrator] retry prompt loaded: %s (size:%d, sha256:%s)`, abs, size, sha.slice(0, 12));
    return { path: abs, text: raw, sha, size };
  } catch (e: any) {
    console.warn(`[NDJC:orchestrator] retry prompt load failed: ${e?.message}`);
    return { path: hint, text: "", sha: "", size: 0 };
  }
}

function ensurePackageId(input?: string, fallback = "com.ndjc.demo.core") {
  let v = (input || "").trim();
  if (!v) return fallback;
  v = v.replace(/[^a-zA-Z0-9_.]+/g, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
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
const localesToResConfigs = (locales: string[]) => locales.join(",");

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

function toUnixPath(p: string) {
  return (p || "").replace(/^[\\/]+/, "").replace(/\\/g, "/").replace(/\/+/g, "/");
}
function sanitizeCompanions(list?: Companion[]): Companion[] {
  const src = Array.isArray(list) ? list : [];
  const out: Companion[] = [];
  for (const it of src) {
    if (!it || typeof it.path !== "string") continue;
    const rel = toUnixPath(it.path);
    if (!rel || rel.startsWith("../") || rel.includes("..%2f")) continue;
    out.push({
      path: rel,
      content: typeof it.content === "string" ? it.content : "",
      overwrite: !!it.overwrite,
      kind: it.kind || "txt",
    });
  }
  return out;
}

/** ----- normalize & validate ----- */
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

function tryAssign(out: any, key: string, val: any) {
  if (key.startsWith("TEXT:")) out.text[key.replace(/^TEXT:/, "") || key] = String(val ?? "");
  else if (key.startsWith("BLOCK:")) out.block[key.replace(/^BLOCK:/, "") || key] = String(val ?? "");
  else if (key.startsWith("LIST:"))
    out.list[key.replace(/^LIST:/, "") || key] = Array.isArray(val) ? val.map(String) : (val == null ? [] : [String(val)]);
  else if (key.startsWith("IF:")) out.if[key.replace(/^IF:/, "") || key] = !!val;
  else if (key.startsWith("HOOK:")) out.hook[key.replace(/^HOOK:/, "") || key] = Array.isArray(val) ? val.join("\n") : String(val ?? "");
}

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;
  if (/^ROUTES$|FIELDS$|FLAGS$|STYLES$|PATTERNS$|PROGUARD|SPLITS|STRINGS$/i.test(k)) return `LIST:${k}`;
  if (/^PERMISSION|INTENT|NETWORK|FILE_PROVIDER/i.test(k)) return `IF:${k}`;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^DEBUG_|^BUILD_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(k)) return `BLOCK:${k}`;
  return k;
}

function applyWhitelistAndAliases(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };
  const groups: AnchorGroup[] = ["text", "block", "list", "if", "hook"];
  const from = raw || {};
  for (const g of groups) {
    const m = from[g] || {};
    for (const [k, v] of Object.entries(m)) {
      const key1 = /^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k) ? k : normalizeKeyWithAliases(k, reg.aliases);
      const mapped = reg.aliases?.[key1] || reg.aliases?.[k];
      const key2 = mapped || key1;
      tryAssign(out, key2, v);
    }
  }
  if (from.gradle && typeof from.gradle === "object") out.gradle = { ...from.gradle };

  (["text","block","list","if","hook"] as AnchorGroup[]).forEach((g) => {
    const allow = pickWhitelist(g, reg);
    out[g] = Object.fromEntries(Object.entries(out[g]).filter(([k]) => allow.has(k)));
  });
  return out;
}

function validateValue(group: AnchorGroup, key: string, val: any, reg: Registry, report: { invalid: string[] }, reasons: string[]) {
  // deny & empty
  if (group === "list") {
    const arr = Array.isArray(val) ? val : [];
    if (arr.length === 0) { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} empty-list`); return false; }
    for (const it of arr) {
      if (typeof it !== "string" || it.length < LIST_ITEM_MIN_LEN || DENY_PATTERNS.some(r => r.test(it))) {
        report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} item-invalid`); return false;
      }
    }
  } else if (group === "if") {
    // boolean only
    if (typeof val !== "boolean") { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} not-boolean`); return false; }
  } else {
    const s = String(val ?? "");
    if (!s || violatesDeny(s)) { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} deny/empty`); return false; }
    if (group === "block") {
      if (s.length < BLOCK_MIN_LEN || !BLOCK_MUST_CONTAIN_ANY.some(tok => s.includes(tok))) {
        report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} block-too-weak`); return false;
      }
    }
    if (group === "hook") {
      if (s.length < HOOK_MIN_LEN) { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} hook-too-short`); return false; }
    }
  }

  // valueFormat
  const vf = reg.valueFormat || {};
  const g = (vf as any)[group] || {};
  const spec = g[key];
  if (!spec) return true;

  const valStr = typeof val === "string" ? val : "";
  if ((spec as any).minLen && valStr.length < (spec as any).minLen) {
    report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} minLen`); return false;
  }
  if ((spec as any).maxLen && valStr.length > (spec as any).maxLen) {
    report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} maxLen`); return false;
  }
  if ((spec as any).enum && !(spec as any).enum.includes(val)) {
    report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} enum`); return false;
  }
  if ((spec as any).regex && !(new RegExp((spec as any).regex).test(valStr))) {
    report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} regex`); return false;
  }

  if (group === "list" && (spec as any).itemRegex) {
    const re = new RegExp((spec as any).itemRegex);
    for (const it of (val as string[])) if (!re.test(String(it))) {
      report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} itemRegex`); return false;
    }
  }
  if (group === "gradle") {
    if (key === "applicationId") {
      const re = new RegExp((reg.valueFormat?.gradle?.applicationId?.regex) || "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$");
      if (!re.test(String(val))) { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} regex`); return false; }
    }
    if (key === "resConfigs") {
      const re = new RegExp((reg.valueFormat?.gradle?.resConfigs?.itemRegex) || "^[a-z]{2}(-r[A-Z]{2})?$");
      for (const it of (val as string[])) if (!re.test(String(it))) { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} itemRegex`); return false; }
    }
    if (key === "permissions") {
      const re = new RegExp((reg.valueFormat?.gradle?.permissions?.itemRegex) || "^android\\.permission\\.[A-Z_]+$");
      for (const it of (val as string[])) if (!re.test(String(it))) { report.invalid.push(`${group}:${key}`); reasons.push(`${group}:${key} itemRegex`); return false; }
    }
  }
  return true;
}

function enforceRequiredAndFormats(doc: any, reg: Registry) {
  const req = reg.required || {};
  const report = { invalid: [] as string[], reasons: [] as string[] };

  doc.text ||= {}; doc.block ||= {}; doc.list ||= {}; doc.if ||= {}; doc.hook ||= {}; doc.gradle ||= {};

  // 补全 required 为空的键（用合成安全值，不用占位符）
  (req.text || []).forEach(k => { if (isEmptyLike(doc.text[k])) doc.text[k] = synthesizeSafeValue("text", k); });
  (req.block || []).forEach(k => { if (isEmptyLike(doc.block[k])) doc.block[k] = synthesizeSafeValue("block", k); });
  (req.list || []).forEach(k => { if (isEmptyLike(doc.list[k])) doc.list[k] = synthesizeSafeValue("list", k); });
  (req.if || []).forEach(k => { if (doc.if[k] == null) doc.if[k] = synthesizeSafeValue("if", k); });
  (req.hook || []).forEach(k => { if (isEmptyLike(doc.hook[k])) doc.hook[k] = synthesizeSafeValue("hook", k); });
  (req.gradle || []).forEach(k => { if (doc.gradle[k] == null) doc.gradle[k] = synthesizeSafeValue("gradle", k); });

  // 针对每个组做强校验，不合规时替换为安全值并记录
  (["text","block","list","if","hook"] as AnchorGroup[]).forEach((g) => {
    Object.keys(doc[g]).forEach((key) => {
      const ok = validateValue(g, key, doc[g][key], reg, report, report.reasons);
      if (!ok) doc[g][key] = synthesizeSafeValue(g, key);
    });
  });

  if (doc.gradle) {
    (["applicationId","resConfigs","permissions"] as const).forEach((key) => {
      const ok = validateValue("gradle" as AnchorGroup, key, doc.gradle[key], reg, report, report.reasons);
      if (!ok) doc.gradle[key] = synthesizeSafeValue("gradle", key);
    });
  }

  // 关键联动：applicationId ←→ NDJC:PACKAGE_NAME
  const appId = ensurePackageId(doc.gradle.applicationId || doc.text["NDJC:PACKAGE_NAME"], "com.ndjc.app");
  doc.gradle.applicationId = appId;
  doc.text["NDJC:PACKAGE_NAME"] = appId;

  return { doc, report };
}

/** ---------------- main orchestrate ---------------- */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg =
    (await loadRegistry())!;

  const sysPrompt = await loadSystemPrompt();
  const rtyPrompt = await loadRetryPrompt();

  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Home";
  let mainButtonText = input.mainButtonText || "Create";
  let packageId = ensurePackageId(input.packageId || input.packageName || "com.ndjc.app", "com.ndjc.app");

  let permissions = input.permissions || [];
  let locales = normalizeLocales(input.locales);
  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = (input.template as any) || (reg.template || "circle-basic");

  const _trace: any = {
    retries: [],
    source: {
      registry_file: process.env.NDJC_REGISTRY_FILE || path.join(ROOT, "lib/ndjc/anchors/registry.circle-basic.json"),
      prompt_file: sysPrompt.path,
      prompt_sha256: sysPrompt.sha,
      retry_file: rtyPrompt.path,
      retry_sha256: rtyPrompt.sha,
      model: process.env.NDJC_MODEL || "groq",
    },
  };

  const skeleton = (() => {
    const text: Record<string, string> = {};
    reg.text.forEach(k => {
      if (k === "NDJC:APP_LABEL") text[k] = appName;
      else if (k === "NDJC:HOME_TITLE") text[k] = homeTitle;
      else if (k === "NDJC:PRIMARY_BUTTON_TEXT") text[k] = mainButtonText;
      else if (k === "NDJC:PACKAGE_NAME") text[k] = packageId;
      else text[k] = reg.placeholders?.text?.[k] ?? "ok";
    });
    const block: Record<string, string> =
      Object.fromEntries(reg.block.map(k => [k, reg.placeholders?.block?.[k] ?? "@Composable fun Safe(){ androidx.compose.material3.Text(\"ok\") }"]));
    const list: Record<string, string[]> =
      Object.fromEntries(reg.list.map(k => [k, reg.placeholders?.list?.[k] ?? ["ok"]]));
    const iff: Record<string, boolean> =
      Object.fromEntries(reg.if.map(k => [k, reg.placeholders?.if?.[k] ?? false]));
    const hook: Record<string, string> =
      Object.fromEntries(reg.hook.map(k => [k, reg.placeholders?.hook?.[k] ?? "echo ok"]));
    const gradle = {
      applicationId: packageId,
      resConfigs: locales,
      permissions: permissions,
    };
    return { text, block, list, if: iff, hook, gradle };
  })();

  const baseUser = [
    "Return STRICT JSON only. Use the SAME keys of SKELETON. Do not add or remove any keys.",
    "All anchors MUST be filled with compilable values. No placeholders, no empty strings, no invalid regex values.",
    "Text must be non-empty; Block must contain @Composable/fun/LazyColumn/Modifier and >= 30 chars; Hook >= 10 chars; List items >=2 chars; Gradle fields must match regex.",
    "SKELETON:",
    JSON.stringify({ metadata: { template, appName, packageId, mode }, anchors: skeleton, files: [] }, null, 2),
    (input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``),
  ].filter(Boolean).join("\n");

  console.log(
    `[NDJC:orchestrator] using system prompt: %s (sha256:%s, size:%d)`,
    sysPrompt.path, (sysPrompt.sha || "").slice(0, 12), sysPrompt.size
  );
  console.log(
    `[NDJC:orchestrator] using retry prompt : %s (sha256:%s, size:%d)`,
    rtyPrompt.path, (rtyPrompt.sha || "").slice(0, 12), rtyPrompt.size
  );

  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [
        { role: "system", content: sysPrompt.text || "Return JSON only." },
        { role: "user", content: baseUser },
      ];

      if (attempt > 0) {
        if (lastText) msgs.push({ role: "assistant", content: lastText });
        const prev = _trace.retries?.[attempt - 1]?.report?.reasons || [];
        const retryText = (rtyPrompt.text || "Fix issues and return JSON only.")
          + (prev.length ? ("\n\nIssues:\n- " + prev.join("\n- ")) : "");
        msgs.push({ role: "user", content: retryText });
      }

      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = applyWhitelistAndAliases(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const { doc, report } = enforceRequiredAndFormats(
        { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} },
        reg
      );

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _ok: report.invalid.length === 0, report };
      _trace.retries.push({ attempt, ok: parsed._ok, report });

      if (parsed._ok) break;
    } catch (e: any) {
      _trace.retries.push({ attempt, error: e?.message || String(e) });
    }
  }

  // 提取关键值
  if (parsed?.anchors?.text) {
    appName = parsed.anchors.text["NDJC:APP_LABEL"] || appName;
    homeTitle = parsed.anchors.text["NDJC:HOME_TITLE"] || homeTitle;
    mainButtonText = parsed.anchors.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;
    packageId = ensurePackageId(parsed.anchors.text["NDJC:PACKAGE_NAME"] || packageId, packageId);
  }
  const gradle = parsed?.anchors?.gradle || {};
  if (Array.isArray(gradle.resConfigs)) locales = normalizeLocales(gradle.resConfigs);
  if (Array.isArray(gradle.permissions)) permissions = gradle.permissions;
  if (allowCompanions && Array.isArray(parsed?._raw?.files)) companions = sanitizeCompanions(parsed._raw.files);

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(input.intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  return {
    template,
    mode,
    allowCompanions,

    appName,
    homeTitle,
    mainButtonText,
    packageId,

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
