// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** ---------------- types ---------------- */
type ValueSchema =
  | {
      valueType: "string";
      valueFormat?: string; // regex
      enum?: string[];
      min?: number;
      max?: number;
      placeholder?: string;
      examples?: string[];
    }
  | {
      valueType: "int";
      min?: number;
      max?: number;
      placeholder?: string;
      examples?: string[];
    }
  | {
      valueType: "enum";
      enum: string[];
      placeholder?: string;
      examples?: string[];
    }
  | {
      // code/file/array/boolean 这些在具体分支处理
      valueType: "code" | "file" | "array" | "boolean";
      itemType?: "string";
      itemFormat?: string; // regex for array items
      placeholder?: any;
      examples?: any[];
      mime?: string;
      languageHint?: string;
    }
  | {
      // 未知/兜底
      valueType: string;
      placeholder?: any;
      [k: string]: any;
    };

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
  valueSchemas?: {
    text?: Record<string, ValueSchema>;
    block?: Record<string, ValueSchema> | { ["*"]?: ValueSchema };
    list?: Record<string, ValueSchema> | { ["*"]?: ValueSchema };
    if?: Record<string, ValueSchema> | { ["*"]?: ValueSchema };
    hook?: Record<string, ValueSchema> | { ["*"]?: ValueSchema };
    resources?: Record<string, ValueSchema>;
    gradle?: Record<string, ValueSchema>;
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

function wantV1(input: Partial<OrchestrateInput>): boolean {
  const envRaw = (process.env.NDJC_CONTRACT_V1 || "").trim().toLowerCase();
  return (
    input.contract === "v1" ||
    input.contractV1 === true ||
    envRaw === "1" ||
    envRaw === "true" ||
    envRaw === "v1"
  );
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
  return arr.length ? arr : ["en", "zh-rCN", "zh-rTW"];
}
function localesToResConfigs(locales: string[]) {
  return locales.join(",");
}

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

async function loadRegistry(): Promise<Registry | null> {
  const hint =
    process.env.NDJC_REGISTRY_FILE ||
    process.env.REGISTRY_FILE ||
    path.join(ROOT, "lib/ndjc/anchors/registry.circle-basic.json");
  try {
    const buf = await fs.readFile(hint, "utf8");
    const json = JSON.parse(buf) as Registry;
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

async function readTextAndHash(filePath: string) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const raw = await fs.readFile(abs, "utf8");
  const sha = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { abs, raw, sha, size: Buffer.byteLength(raw) };
}

async function loadSystemPrompt() {
  const hint =
    process.env.NDJC_PROMPT_SYSTEM_FILE ||
    path.join(ROOT, "lib/ndjc/prompts/contract_v1.en.json");
  try {
    const { abs, raw, sha, size } = await readTextAndHash(hint);
    let text = raw;
    // allow .json or .txt; if json with { "system": "..." }
    try {
      const maybe = JSON.parse(raw);
      if (maybe && typeof maybe.system === "string") {
        text = maybe.system;
      }
    } catch {
      /* not json -> treat as plain text */
    }
    console.log(
      `[NDJC:orchestrator] system prompt loaded: %s (size:%d, sha256:%s)`,
      abs,
      size,
      sha.slice(0, 12)
    );
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
    console.log(
      `[NDJC:orchestrator] retry prompt loaded: %s (size:%d, sha256:%s)`,
      abs,
      size,
      sha.slice(0, 12)
    );
    return { path: abs, text: raw, sha, size };
  } catch (e: any) {
    console.warn(`[NDJC:orchestrator] retry prompt load failed: ${e?.message}`);
    return { path: hint, text: "", sha: "", size: 0 };
  }
}

/** ----- normalization / whitelist / defaults / required ----- */

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // Fallback guess
  if (/^ROUTES$|FIELDS$|FLAGS$|STYLES$|PATTERNS$|PROGUARD|SPLITS|STRINGS$/i.test(k)) return `LIST:${k}`;
  if (/^PERMISSION|INTENT|NETWORK|FILE_PROVIDER/i.test(k)) return `IF:${k}`;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^DEBUG_|^BUILD_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(k)) return `BLOCK:${k}`;
  return k;
}

function setOf<T = string>(arr?: T[]) {
  return new Set(Array.isArray(arr) ? (arr as any[]) : []);
}

function normalizeAnchorsUsingRegistry(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };

  const tryAssign = (dict: any, key: string, val: any) => {
    if (key.startsWith("TEXT:")) dict.text[key.replace(/^TEXT:/, "") || key] = String(val ?? "");
    else if (key.startsWith("BLOCK:")) dict.block[key.replace(/^BLOCK:/, "") || key] = String(val ?? "");
    else if (key.startsWith("LIST:"))
      dict.list[key.replace(/^LIST:/, "") || key] = Array.isArray(val) ? val.map(String) : (val == null ? [] : [String(val)]);
    else if (key.startsWith("IF:")) dict.if[key.replace(/^IF:/, "") || key] = !!val;
    else if (key.startsWith("HOOK:")) dict.hook[key.replace(/^HOOK:/, "") || key] = Array.isArray(val) ? val.join("\n") : String(val ?? "");
  };

  // collect potential extra keys before whitelist
  const extra_keys: string[] = [];
  const collect = (obj: any, group: string) => {
    if (!obj) return;
    for (const [k, _] of Object.entries(obj)) {
      const k1 = /^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k) ? k : normalizeKeyWithAliases(k, reg.aliases);
      const mapped = reg.aliases?.[k1] || reg.aliases?.[k];
      const key2 = (mapped || k1);
      const groupName = key2.split(":")[0];
      const pure = key2.replace(/^(TEXT|BLOCK|LIST|IF|HOOK):/, "");
      const allow =
        (groupName === "TEXT" && (reg.text || []).includes(pure)) ||
        (groupName === "BLOCK" && (reg.block || []).includes(pure)) ||
        (groupName === "LIST" && (reg.list || []).includes(pure)) ||
        (groupName === "IF" && (reg.if || []).includes(pure)) ||
        (groupName === "HOOK" && (reg.hook || []).includes(pure));
      if (!allow) extra_keys.push(`${group}:${k}`);
    }
  };
  collect(raw?.text, "text");
  collect(raw?.block, "block");
  collect(raw?.list, "list");
  collect(raw?.if, "if");
  collect(raw?.hook, "hook");

  const groups = ["text", "block", "list", "if", "hook"];
  const from = raw || {};
  for (const g of groups) {
    const m = from[g] || {};
    for (const [k, v] of Object.entries(m)) {
      let key1 = /^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k) ? k : normalizeKeyWithAliases(k, reg.aliases);
      const mapped = reg.aliases?.[key1] || reg.aliases?.[k];
      const key2 = mapped || key1;
      tryAssign(out, key2, v);
    }
  }
  if (from.gradle && typeof from.gradle === "object") out.gradle = { ...from.gradle };

  // whitelist trim
  const keep = {
    text: setOf(reg.text),
    block: setOf(reg.block),
    list: setOf(reg.list),
    if: setOf(reg.if),
    hook: setOf(reg.hook),
  };
  const filterDict = (d: Record<string, any>, allow: Set<string>) =>
    Object.fromEntries(Object.entries(d).filter(([k]) => allow.has(k)));

  out.text = filterDict(out.text, keep.text);
  out.block = filterDict(out.block, keep.block);
  out.list = filterDict(out.list, keep.list);
  out.if = filterDict(out.if, keep.if);
  out.hook = filterDict(out.hook, keep.hook);

  (out as any)._extra_keys = extra_keys;
  return out;
}

function applyDefaultsAndCheckRequired(doc: any, reg: Registry) {
  const req = reg.required || {};
  const def = reg.defaults || {};
  const report = {
    filled: { text: [] as string[], list: [] as string[], gradle: [] as string[] },
    missing: [] as string[],
  };

  // TEXT required
  for (const k of req.text || []) {
    if (!doc.text?.[k]) {
      const dv = def.text?.[k] ?? "";
      if (dv !== "") {
        doc.text[k] = dv;
        report.filled.text.push(k);
      } else {
        report.missing.push(`text:${k}`);
      }
    }
  }

  // LIST required
  for (const k of req.list || []) {
    const cur = doc.list?.[k];
    if (!Array.isArray(cur) || cur.length === 0) {
      const dv = def.list?.[k] ?? [];
      if (dv.length) {
        doc.list[k] = dv;
        report.filled.list.push(k);
      } else {
        report.missing.push(`list:${k}`);
      }
    }
  }

  // GRADLE required
  if (!doc.gradle) doc.gradle = {};
  for (const k of req.gradle || []) {
    if (k === "applicationId") {
      let appId =
        doc.gradle.applicationId ||
        doc.text?.["NDJC:PACKAGE_NAME"] ||
        def.text?.["NDJC:PACKAGE_NAME"] ||
        def.gradle?.applicationId;
      appId = ensurePackageId(appId, "com.ndjc.demo.core");
      if (!appId) report.missing.push("gradle:applicationId");
      else {
        doc.gradle.applicationId = appId;
        if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId;
        report.filled.gradle.push("applicationId");
      }
    } else {
      if (doc.gradle[k] == null && (def.gradle as any)?.[k] != null) {
        (doc.gradle as any)[k] = (def.gradle as any)[k];
        report.filled.gradle.push(k);
      }
    }
  }

  // fallback: resConfigs/permissions defaults
  if (!Array.isArray(doc.gradle.resConfigs) && Array.isArray(def.gradle?.resConfigs)) {
    doc.gradle.resConfigs = def.gradle!.resConfigs;
  }
  if (!Array.isArray(doc.gradle.permissions) && Array.isArray(def.gradle?.permissions)) {
    doc.gradle.permissions = def.gradle!.permissions;
  }

  const ok = report.missing.length === 0;
  return { ok, report, doc };
}

/** ----- inline validators & placeholders (方案A) ----- */

const PLACEHOLDERS = {
  text: "__NDJC_PLACEHOLDER_TEXT__",
  listItem: "__NDJC_PLACEHOLDER_ITEM__",
  blockXml: "<!-- __NDJC_PLACEHOLDER_BLOCK__ -->",
  hookCode: "// __NDJC_PLACEHOLDER_HOOK__",
};

function isString(x: any): x is string {
  return typeof x === "string";
}
function isBoolean(x: any): x is boolean {
  return typeof x === "boolean";
}
function isArray(x: any): x is any[] {
  return Array.isArray(x);
}
function isIntStr(x: any) {
  if (!isString(x)) return false;
  if (!/^-?\d+$/.test(x)) return false;
  return true;
}
function matchRegex(s: string, pattern?: string) {
  if (!pattern) return true;
  try {
    const re = new RegExp(pattern);
    return re.test(s);
  } catch {
    return true; // invalid regex in schema -> ignore
  }
}

type ValidationReport = {
  violations: { key: string; reason: string; got?: any; expect?: any }[];
  placeholders_filled: { key: string; from?: any; placeholder: any }[];
  required_missing: string[];
  extra_keys: string[];
};

function pickSchema(group: keyof Registry["valueSchemas"], key: string, reg: Registry): ValueSchema | undefined {
  const vs = reg.valueSchemas || {};
  const map = (vs as any)[group] || {};
  return map[key] || map["*"];
}

function placeholderFor(group: "text" | "block" | "list" | "if" | "hook" | "resources" | "gradle", key: string, reg: Registry) {
  const sch = pickSchema(group as any, key, reg);
  if (sch && (sch as any).placeholder != null) return (sch as any).placeholder;

  switch (group) {
    case "text":
      return PLACEHOLDERS.text;
    case "block":
      return PLACEHOLDERS.blockXml;
    case "list":
      return [PLACEHOLDERS.listItem];
    case "if":
      return false;
    case "hook":
      return PLACEHOLDERS.hookCode;
    case "resources":
      return key; // 资源占位：返回其标识，物化阶段可忽略/查找
    case "gradle":
      if (key === "applicationId") return "com.ndjc.demo.core";
      if (key === "resConfigs") return ["en", "zh-rCN", "zh-rTW"];
      if (key === "permissions") return [];
      return "";
    default:
      return "";
  }
}

function validateAndFix(doc: any, reg: Registry): ValidationReport {
  const rep: ValidationReport = {
    violations: [],
    placeholders_filled: [],
    required_missing: [],
    extra_keys: Array.isArray(doc?._extra_keys) ? doc._extra_keys : [],
  };

  // ensure groups exist
  doc.text ||= {};
  doc.block ||= {};
  doc.list ||= {};
  doc.if ||= {};
  doc.hook ||= {};
  doc.gradle ||= {};

  // 1) 覆盖率：所有白名单键都要存在；缺失→占位
  for (const k of reg.text || []) {
    if (!isString(doc.text[k]) || doc.text[k] === "") {
      const ph = placeholderFor("text", k, reg);
      rep.placeholders_filled.push({ key: `text:${k}`, from: doc.text[k], placeholder: ph });
      doc.text[k] = String(ph);
    }
  }
  for (const k of reg.block || []) {
    if (!isString(doc.block[k]) || doc.block[k] === "") {
      const ph = placeholderFor("block", k, reg);
      rep.placeholders_filled.push({ key: `block:${k}`, from: doc.block[k], placeholder: ph });
      doc.block[k] = String(ph);
    }
  }
  for (const k of reg.list || []) {
    if (!isArray(doc.list[k]) || doc.list[k].length === 0) {
      const ph = placeholderFor("list", k, reg);
      rep.placeholders_filled.push({ key: `list:${k}`, from: doc.list[k], placeholder: ph });
      doc.list[k] = Array.isArray(ph) ? ph : [String(ph)];
    } else {
      doc.list[k] = doc.list[k].map((s: any) => String(s));
    }
  }
  for (const k of reg.if || []) {
    if (!isBoolean(doc.if[k])) {
      const ph = placeholderFor("if", k, reg);
      rep.placeholders_filled.push({ key: `if:${k}`, from: doc.if[k], placeholder: ph });
      doc.if[k] = !!ph;
    }
  }
  for (const k of reg.hook || []) {
    if (!isString(doc.hook[k]) || doc.hook[k] === "") {
      const ph = placeholderFor("hook", k, reg);
      rep.placeholders_filled.push({ key: `hook:${k}`, from: doc.hook[k], placeholder: ph });
      doc.hook[k] = String(ph);
    }
  }
  doc.gradle.applicationId = ensurePackageId(doc.gradle.applicationId || doc.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core");
  if (!isArray(doc.gradle.resConfigs)) doc.gradle.resConfigs = placeholderFor("gradle", "resConfigs", reg);
  if (!isArray(doc.gradle.permissions)) doc.gradle.permissions = placeholderFor("gradle", "permissions", reg);

  // 2) 值合规：按 valueSchemas 校验，非法→占位并记录 violations
  const checkTextKey = (k: string) => {
    const v = doc.text[k];
    const sch = pickSchema("text", k, reg);
    if (!sch) return;
    if ((sch as any).enum && Array.isArray((sch as any).enum)) {
      if (!(sch as any).enum.includes(String(v))) {
        rep.violations.push({ key: `text:${k}`, reason: "enum", got: v, expect: (sch as any).enum });
        const ph = placeholderFor("text", k, reg);
        if (v !== ph) {
          doc.text[k] = String(ph);
          rep.placeholders_filled.push({ key: `text:${k}`, from: v, placeholder: ph });
        }
      }
    } else if ((sch as any).valueType === "int") {
      if (!isIntStr(String(v))) {
        rep.violations.push({ key: `text:${k}`, reason: "type:int", got: v });
        const ph = placeholderFor("text", k, reg);
        doc.text[k] = String(ph);
        rep.placeholders_filled.push({ key: `text:${k}`, from: v, placeholder: ph });
      } else {
        const n = parseInt(String(v), 10);
        const min = (sch as any).min ?? -Infinity;
        const max = (sch as any).max ?? Infinity;
        if (n < min || n > max) {
          rep.violations.push({ key: `text:${k}`, reason: "range", got: n, expect: { min, max } });
          const ph = placeholderFor("text", k, reg);
          doc.text[k] = String(ph);
          rep.placeholders_filled.push({ key: `text:${k}`, from: v, placeholder: ph });
        }
      }
    } else {
      // string with regex
      if (!isString(v) || !matchRegex(String(v), (sch as any).valueFormat)) {
        rep.violations.push({ key: `text:${k}`, reason: "format", got: v, expect: (sch as any).valueFormat });
        const ph = placeholderFor("text", k, reg);
        doc.text[k] = String(ph);
        rep.placeholders_filled.push({ key: `text:${k}`, from: v, placeholder: ph });
      }
    }
  };
  for (const k of reg.text || []) checkTextKey(k);

  const checkListKey = (k: string) => {
    const v = doc.list[k];
    const sch = pickSchema("list", k, reg);
    const itemFmt = (sch as any)?.itemFormat;
    if (!Array.isArray(v) || v.length === 0) {
      const ph = placeholderFor("list", k, reg);
      rep.violations.push({ key: `list:${k}`, reason: "empty" });
      doc.list[k] = Array.isArray(ph) ? ph : [String(ph)];
      rep.placeholders_filled.push({ key: `list:${k}`, from: v, placeholder: doc.list[k] });
    } else if (itemFmt) {
      const fixed: string[] = [];
      let changed = false;
      for (const it of v) {
        const s = String(it);
        if (matchRegex(s, itemFmt)) fixed.push(s);
        else {
          changed = true;
          fixed.push(String(PLACEHOLDERS.listItem));
          rep.violations.push({ key: `list:${k}`, reason: "item_format", got: s, expect: itemFmt });
        }
      }
      if (changed) {
        doc.list[k] = fixed;
        rep.placeholders_filled.push({ key: `list:${k}`, placeholder: fixed });
      }
    }
  };
  for (const k of reg.list || []) checkListKey(k);

  const checkIfKey = (k: string) => {
    const v = doc.if[k];
    if (typeof v !== "boolean") {
      rep.violations.push({ key: `if:${k}`, reason: "type:boolean", got: v });
      const ph = placeholderFor("if", k, reg);
      doc.if[k] = !!ph;
      rep.placeholders_filled.push({ key: `if:${k}`, from: v, placeholder: ph });
    }
  };
  for (const k of reg.if || []) checkIfKey(k);

  const checkBlockKey = (k: string) => {
    const v = doc.block[k];
    if (!isString(v) || v.trim() === "") {
      rep.violations.push({ key: `block:${k}`, reason: "empty" });
      const ph = placeholderFor("block", k, reg);
      doc.block[k] = String(ph);
      rep.placeholders_filled.push({ key: `block:${k}`, from: v, placeholder: ph });
    }
  };
  for (const k of reg.block || []) checkBlockKey(k);

  const checkHookKey = (k: string) => {
    const v = doc.hook[k];
    if (!isString(v) || v.trim() === "") {
      rep.violations.push({ key: `hook:${k}`, reason: "empty" });
      const ph = placeholderFor("hook", k, reg);
      doc.hook[k] = String(ph);
      rep.placeholders_filled.push({ key: `hook:${k}`, from: v, placeholder: ph });
    }
  };
  for (const k of reg.hook || []) checkHookKey(k);

  // gradle
  const gschApp = reg.valueSchemas?.gradle?.applicationId as ValueSchema | undefined;
  if (gschApp && gschApp.valueType === "string" && (gschApp as any).valueFormat) {
    const ok = matchRegex(String(doc.gradle.applicationId || ""), (gschApp as any).valueFormat);
    if (!ok) {
      rep.violations.push({
        key: "gradle:applicationId",
        reason: "format",
        got: doc.gradle.applicationId,
        expect: (gschApp as any).valueFormat,
      });
      const ph = placeholderFor("gradle", "applicationId", reg);
      doc.gradle.applicationId = String(ph);
      rep.placeholders_filled.push({ key: "gradle:applicationId", from: doc.gradle.applicationId, placeholder: ph });
    }
  }

  // required_missing（最终兜底再检查一次）
  const req = reg.required || {};
  for (const k of req.text || []) if (!doc.text?.[k]) rep.required_missing.push(`text:${k}`);
  for (const k of req.block || []) if (!doc.block?.[k]) rep.required_missing.push(`block:${k}`);
  for (const k of req.list || []) if (!isArray(doc.list?.[k]) || doc.list[k].length === 0) rep.required_missing.push(`list:${k}`);
  for (const k of req.if || []) if (typeof doc.if?.[k] !== "boolean") rep.required_missing.push(`if:${k}`);
  for (const k of req.hook || []) if (!doc.hook?.[k]) rep.required_missing.push(`hook:${k}`);
  for (const k of req.gradle || []) if (doc.gradle?.[k] == null) rep.required_missing.push(`gradle:${k}`);

  return rep;
}

/** ---------------- main orchestrate ---------------- */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg =
    (await loadRegistry()) || {
      template: "circle-basic",
      text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
      block: [],
      list: ["ROUTES"],
      if: [],
      hook: [],
      aliases: {},
      required: { text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"], list: ["ROUTES"], gradle: ["applicationId"] },
      defaults: { text: { "NDJC:PACKAGE_NAME": "com.ndjc.demo.core", "NDJC:APP_LABEL": "NDJC App", "NDJC:HOME_TITLE": "Home", "NDJC:PRIMARY_BUTTON_TEXT": "Start" }, list: { "ROUTES": ["home"] }, gradle: { resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] } }
    };

  const sysPrompt = await loadSystemPrompt();
  const rtyPrompt = await loadRetryPrompt();

  let appName = input.appName || reg.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App";
  let homeTitle = input.homeTitle || reg.defaults?.text?.["NDJC:HOME_TITLE"] || "Home";
  let mainButtonText = input.mainButtonText || reg.defaults?.text?.["NDJC:PRIMARY_BUTTON_TEXT"] || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName || reg.defaults?.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core");

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);

  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = (input.template as any) || (reg.template || "circle-basic");

  /** 记录来源以便产物 & 日志确认 */
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

  // SKELETON（所有键齐全、值先置空/默认）
  const skeleton = (() => {
    const defText = reg.defaults?.text || {};
    const defList = reg.defaults?.list || {};
    const text: Record<string, string> = {};
    for (const k of reg.text) {
      if (k === "NDJC:APP_LABEL") text[k] = appName || defText[k] || "";
      else if (k === "NDJC:HOME_TITLE") text[k] = homeTitle || defText[k] || "";
      else if (k === "NDJC:PRIMARY_BUTTON_TEXT") text[k] = mainButtonText || defText[k] || "";
      else if (k === "NDJC:PACKAGE_NAME") text[k] = packageId || defText[k] || "";
      else text[k] = defText[k] ?? "";
    }
    const block: Record<string, string> = Object.fromEntries(reg.block.map((k) => [k, ""]));
    const list: Record<string, string[]> = Object.fromEntries(reg.list.map((k) => [k, defList[k] ?? []]));
    const iff: Record<string, boolean> = Object.fromEntries(reg.if.map((k) => [k, false]));
    const hook: Record<string, string> = Object.fromEntries(reg.hook.map((k) => [k, ""]));
    const gradle = {
      applicationId: packageId,
      resConfigs: locales,
      permissions: permissions,
    };
    return {
      metadata: { template, appName, packageId, mode },
      anchors: { text, block, list, if: iff, hook, gradle },
      files: [] as any[],
    };
  })();

  // 组装 user 指令（强调“仅 JSON、键集合与 SKELETON 一致”）
  const baseUser = [
    "Return STRICT JSON only. Use the SAME keys of SKELETON. Do not add or remove any keys.",
    "Fill all anchors with values. If not applicable, use placeholders but keep the type.",
    "SKELETON:",
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``),
  ].filter(Boolean).join("\n");

  // 控制台明确打印——用于 Vercel Functions Logs 判断 prompt 是否被调用
  console.log(
    `[NDJC:orchestrator] using system prompt: %s (sha256:%s, size:%d)`,
    sysPrompt.path,
    (sysPrompt.sha || "").slice(0, 12),
    sysPrompt.size
  );
  console.log(
    `[NDJC:orchestrator] using retry prompt : %s (sha256:%s, size:%d)`,
    rtyPrompt.path,
    (rtyPrompt.sha || "").slice(0, 12),
    rtyPrompt.size
  );

  // 生成 + 机器校验→重试
  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";
  let lastReport: ValidationReport | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [
        { role: "system", content: sysPrompt.text || "Return JSON only." },
        { role: "user", content: baseUser },
      ];

      if (attempt > 0) {
        // 上一轮的全文 + 具体问题清单回灌
        if (lastText) msgs.push({ role: "assistant", content: lastText });
        const retryText =
          (rtyPrompt.text || "").trim() ||
          "Fix mistakes. Keep the same keys as SKELETON. Fill required anchors. Return JSON only.";
        const feedbackLines: string[] = [];

        if (lastReport) {
          if (lastReport.required_missing?.length) {
            feedbackLines.push("Missing required anchors:");
            for (const k of lastReport.required_missing) feedbackLines.push(`- ${k}`);
          }
          if (lastReport.violations?.length) {
            feedbackLines.push("Invalid values (type/format/enum/range):");
            for (const v of lastReport.violations.slice(0, 50)) feedbackLines.push(`- ${v.key}: ${v.reason}`);
          }
          if (lastReport.extra_keys?.length) {
            feedbackLines.push("Unknown/extra keys (will be dropped):");
            for (const k of lastReport.extra_keys.slice(0, 50)) feedbackLines.push(`- ${k}`);
          }
        }

        msgs.push({ role: "user", content: [retryText, feedbackLines.join("\n")].filter(Boolean).join("\n\n") });
      }

      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const { ok, report, doc } = applyDefaultsAndCheckRequired(
        { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} },
        reg
      );

      // 机器校验 + 占位修正（满足三硬要求）
      const rep = validateAndFix(doc, reg);
      lastReport = rep;

      parsed = {
        metadata: maybe?.metadata || {},
        anchors: doc,
        _raw: maybe,
        _text: text,
        _report: { required_defaults: report, validation: rep, okRequired: ok },
        _ok: ok && rep.required_missing.length === 0, // 必填通过
      };

      _trace.retries.push({
        attempt,
        ok: parsed._ok && rep.violations.length === 0,
        required_missing: rep.required_missing,
        violations: rep.violations?.slice(0, 100),
        extra_keys: rep.extra_keys?.slice(0, 100),
        placeholders_filled: rep.placeholders_filled?.slice(0, 50),
        feedback:
          rep.required_missing.length || rep.violations.length || rep.extra_keys.length
            ? [
                rep.required_missing.length ? `Missing: ${rep.required_missing.join(", ")}` : "",
                rep.violations.length ? `Violations: ${rep.violations.map((v) => v.key).slice(0, 20).join(", ")}` : "",
                rep.extra_keys.length ? `ExtraKeys: ${rep.extra_keys.slice(0, 20).join(", ")}` : "",
                "Please fix and resend JSON with the SAME key set.",
              ].filter(Boolean).join("\n")
            : undefined,
      });

      // 通过条件：必填 OK 且无 violations（或 violations 已被占位修正后不再出现）
      if (parsed._ok && rep.violations.length === 0) break;
    } catch (e: any) {
      _trace.retries.push({ attempt, error: e?.message || String(e) });
    }
  }

  // 抽取关键值
  if (parsed?.metadata) {
    appName = parsed.metadata.appName || appName;
    packageId = ensurePackageId(parsed.metadata.packageId || packageId, packageId);
  }
  const anchorsFinal = parsed?.anchors || {};
  if (anchorsFinal?.text) {
    appName = anchorsFinal.text["NDJC:APP_LABEL"] || appName;
    homeTitle = anchorsFinal.text["NDJC:HOME_TITLE"] || homeTitle;
    mainButtonText = anchorsFinal.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;
    packageId = ensurePackageId(anchorsFinal.text["NDJC:PACKAGE_NAME"] || packageId, packageId);
  }
  const gradle = parsed?.anchors?.gradle || {};
  if (Array.isArray(gradle.resConfigs)) {
    locales = normalizeLocales(gradle.resConfigs);
  }
  if (Array.isArray(gradle.permissions)) {
    permissions = gradle.permissions;
  }
  if (allowCompanions && Array.isArray(parsed?._raw?.files)) {
    companions = sanitizeCompanions(parsed._raw.files);
  }

  // v1 兜底
  if (wantV1(input) && (!parsed || !parsed._text)) {
    const v1doc = {
      metadata: { runId: (input as any).runId || undefined, template, appName, packageId, mode },
      anchors: {
        text: {
          "NDJC:PACKAGE_NAME": packageId,
          "NDJC:APP_LABEL": appName,
          "NDJC:HOME_TITLE": homeTitle,
          "NDJC:PRIMARY_BUTTON_TEXT": mainButtonText,
        },
        block: {},
        list: { "LIST:ROUTES": ["home"] },
        if: {},
        hook: {},
        gradle: { applicationId: packageId, resConfigs: locales, permissions },
      },
      files: allowCompanions ? companions : [],
    };
    _trace.synthesized = true;
    _trace.rawText = JSON.stringify(v1doc);
  } else {
    _trace.rawText = parsed?._text;
  }

  // 报告合并到 trace
  if (parsed?._report) {
    _trace.validation = parsed._report.validation;
    _trace.required_defaults = parsed._report.required_defaults;
    _trace.okRequired = parsed._report.okRequired;
  }

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
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
