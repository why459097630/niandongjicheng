import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/* ---------- types ---------- */

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

/* ---------- helpers ---------- */

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
  const root = process.cwd();
  const hint =
    process.env.REGISTRY_FILE ||
    process.env.NDJC_REGISTRY_FILE ||
    path.join(root, "lib/ndjc/anchors/registry.circle-basic.json");
  try {
    const buf = await fs.readFile(hint, "utf8");
    return JSON.parse(buf) as Registry;
  } catch {
    return null;
  }
}

/* ---------- prompt files (system + retry) ---------- */

async function loadTextFileMaybe(p?: string | null): Promise<string | null> {
  if (!p) return null;
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

// contract_v1.en.json 可以是：
// 1) 纯文本 (整文件就是 system prompt)
// 2) JSON 对象形如 { "system": "..." }
async function loadSystemPromptFromFile(p?: string | null): Promise<string | null> {
  const t = await loadTextFileMaybe(p);
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    if (j && typeof j.system === "string") return j.system;
  } catch {
    /* not JSON => treat as raw */
  }
  return t;
}

function withPrefix(kind: "BLOCK" | "LIST" | "IF" | "HOOK", xs: string[]): string[] {
  return (xs || []).map((k) => `${kind}:${k}`);
}

/** 把注册表变成“可回填骨架表单”：所有 canonical 键都出现，值给空/默认 */
function buildSkeletonFromRegistry(
  reg: Registry,
  seed: { appName: string; packageId: string; locales: string[] }
) {
  const defText = reg.defaults?.text || {};
  const defList = reg.defaults?.list || {};
  const defGradle = reg.defaults?.gradle || {};

  const text: Record<string, string> = {};
  for (const k of reg.text) {
    if (k === "NDJC:APP_LABEL") text[k] = seed.appName || defText[k] || "";
    else if (k === "NDJC:PACKAGE_NAME") text[k] = seed.packageId || defText[k] || "";
    else text[k] = defText[k] ?? "";
  }

  const block: Record<string, string> = {};
  for (const k of reg.block) block[k] = "";

  const list: Record<string, string[]> = {};
  for (const k of reg.list) list[k] = defList[k] ?? [];

  const iff: Record<string, boolean> = {};
  for (const k of reg.if) iff[k] = false;

  const hook: Record<string, string> = {};
  for (const k of reg.hook) hook[k] = "";

  const gradle = {
    applicationId: seed.packageId || defGradle.applicationId || "",
    resConfigs: seed.locales.length ? seed.locales : (defGradle.resConfigs || []),
    permissions: defGradle.permissions || [],
  };

  return {
    metadata: { template: reg.template, appName: seed.appName, packageId: seed.packageId, mode: "B" },
    anchors: { text, block, list, if: iff, hook, gradle },
    files: [] as any[],
  };
}

/** 生成“类型与格式规范”文本，用于拼到 system prompt */
function buildTypeContractText(reg: Registry): string {
  // 简明的“强约束”规范
  const lines: string[] = [];
  lines.push("Return **Contract v1** JSON. Keys are fixed (must match the SKELETON). Value types:");
  lines.push("- anchors.text: Record<string, string> (pure string; no code fences).");
  lines.push("- anchors.block: Record<string, string> (Kotlin/XML/Gradle snippet as plain string; **no Markdown fences**).");
  lines.push("- anchors.list: Record<string, string[]> (array of strings; no objects).");
  lines.push("- anchors.if: Record<string, boolean> (strict boolean: true/false).");
  lines.push("- anchors.hook: Record<string, string> (plain string snippet; **no Markdown fences**).");
  lines.push("- anchors.gradle: { applicationId: string; resConfigs?: string[]; permissions?: string[] }.");
  lines.push("- files: Companion files array [{path, content, overwrite?, kind?}]. Paths must be project-relative and never escape (no ../).");
  lines.push("Do not invent new keys. Do not omit required keys. If missing info, use defaults provided above. Output must be raw JSON (no Markdown).");
  return lines.join("\n");
}

/** 把 registry + skeleton 等替换进 system prompt 模板（若有） */
function renderSystemPromptTemplate(tmpl: string, reg: Registry, skeleton: any) {
  const allowText = reg.text.join(", ");
  const allowBlock = withPrefix("BLOCK", reg.block).join(", ");
  const allowList = withPrefix("LIST", reg.list).join(", ");
  const allowIf = withPrefix("IF", reg.if).join(", ");
  const allowHook = withPrefix("HOOK", reg.hook).join(", ");
  const required = {
    text: (reg.required?.text || []).join(", "),
    list: (reg.required?.list || []).join(", "),
    block: (reg.required?.block || []).join(", "),
    if: (reg.required?.if || []).join(", "),
    hook: (reg.required?.hook || []).join(", "),
    gradle: (reg.required?.gradle || []).join(", "),
  };
  const defaults = {
    text: JSON.stringify(reg.defaults?.text || {}),
    list: JSON.stringify(reg.defaults?.list || {}),
    gradle: JSON.stringify(reg.defaults?.gradle || {}),
  };

  return tmpl
    .replaceAll("{{TEMPLATE}}", reg.template || "circle-basic")
    .replaceAll("{{CANONICAL_TEXT}}", allowText)
    .replaceAll("{{CANONICAL_BLOCK}}", allowBlock)
    .replaceAll("{{CANONICAL_LIST}}", allowList)
    .replaceAll("{{CANONICAL_IF}}", allowIf)
    .replaceAll("{{CANONICAL_HOOK}}", allowHook)
    .replaceAll("{{REQUIRED_TEXT}}", required.text || "(none)")
    .replaceAll("{{REQUIRED_LIST}}", required.list || "(none)")
    .replaceAll("{{REQUIRED_BLOCK}}", required.block || "(none)")
    .replaceAll("{{REQUIRED_IF}}", required.if || "(none)")
    .replaceAll("{{REQUIRED_HOOK}}", required.hook || "(none)")
    .replaceAll("{{REQUIRED_GRADLE}}", required.gradle || "(none)")
    .replaceAll("{{DEFAULTS_TEXT}}", defaults.text)
    .replaceAll("{{DEFAULTS_LIST}}", defaults.list)
    .replaceAll("{{DEFAULTS_GRADLE}}", defaults.gradle)
    .replaceAll("{{SKELETON_JSON}}", JSON.stringify(skeleton, null, 2))
    .concat("\n\n", buildTypeContractText(reg));
}

/* ---------- alias & prefix normalization ---------- */

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // 最小宽松推断（几乎不会触发；主要靠 skeleton 锁死）
  if (/^ROUTES$|FIELDS$|FLAGS$|STYLES$|PATTERNS$|PROGUARD|SPLITS|STRINGS$/i.test(k)) return `LIST:${k}`;
  if (/^PERMISSION|INTENT|NETWORK|FILE_PROVIDER/i.test(k)) return `IF:${k}`;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^DEBUG_|^BUILD_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(k)) return `BLOCK:${k}`;
  return k;
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

  // 白名单裁剪（canonical）
  const keep = {
    text: new Set(reg.text),
    block: new Set(reg.block),
    list: new Set(reg.list),
    if: new Set(reg.if),
    hook: new Set(reg.hook),
  };
  const filterDict = (d: Record<string, any>, allow: Set<string>) =>
    Object.fromEntries(Object.entries(d).filter(([k]) => allow.has(k)));

  out.text = filterDict(out.text, keep.text);
  out.block = filterDict(out.block, keep.block);
  out.list = filterDict(out.list, keep.list);
  out.if = filterDict(out.if, keep.if);
  out.hook = filterDict(out.hook, keep.hook);

  return out;
}

/* ---------- type validation & coercion ---------- */

function stripCodeFences(s: string): string {
  const t = (s ?? "").trim();
  // remove ```...``` fences if present
  const m = t.match(/^```[a-zA-Z0-9]*\s*([\s\S]*?)\s*```$/);
  return m ? m[1].trim() : t;
}

function asString(x: any): string {
  if (x == null) return "";
  if (typeof x === "string") return stripCodeFences(x);
  try { return stripCodeFences(JSON.stringify(x)); } catch { return String(x); }
}
function asStringArray(x: any): string[] {
  if (Array.isArray(x)) return x.map((v) => String(v));
  if (x == null || x === "") return [];
  return [String(x)];
}
function asBoolean(x: any): boolean {
  if (typeof x === "boolean") return x;
  const s = String(x).trim().toLowerCase();
  return !(s === "" || s === "false" || s === "0" || s === "no" || s === "off" || s === "null" || s === "undefined");
}

function validateAndCoerce(anchors: any, reg: Registry) {
  const issues: string[] = [];
  const coerced = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} as any } as any;

  // text
  for (const k of reg.text) {
    const v = anchors?.text?.[k];
    if (v == null) continue;
    const sv = asString(v);
    coerced.text[k] = sv;
    if (typeof v !== "string") issues.push(`text:${k} expected string; got ${typeof v} -> coerced`);
  }

  // block
  for (const k of reg.block) {
    const v = anchors?.block?.[k];
    if (v == null) continue;
    const sv = asString(v);
    coerced.block[k] = sv;
    if (typeof v !== "string") issues.push(`block:${k} expected string; got ${typeof v} -> coerced`);
    if (/^```/.test(String(v).trim())) issues.push(`block:${k} must NOT use Markdown fences -> stripped`);
  }

  // list
  for (const k of reg.list) {
    const v = anchors?.list?.[k];
    if (v == null) continue;
    const arr = asStringArray(v);
    coerced.list[k] = arr;
    if (!Array.isArray(v)) issues.push(`list:${k} expected string[]; got ${typeof v} -> coerced`);
  }

  // if
  for (const k of reg.if) {
    const v = anchors?.if?.[k];
    if (v == null) continue;
    const b = asBoolean(v);
    coerced.if[k] = b;
    if (typeof v !== "boolean") issues.push(`if:${k} expected boolean; got ${typeof v} -> coerced`);
  }

  // hook
  for (const k of reg.hook) {
    const v = anchors?.hook?.[k];
    if (v == null) continue;
    const sv = asString(v);
    coerced.hook[k] = sv;
    if (typeof v !== "string") issues.push(`hook:${k} expected string; got ${typeof v} -> coerced`);
    if (/^```/.test(String(v).trim())) issues.push(`hook:${k} must NOT use Markdown fences -> stripped`);
  }

  // gradle
  const g = anchors?.gradle || {};
  coerced.gradle = {
    applicationId: g.applicationId ? ensurePackageId(String(g.applicationId)) : undefined,
    resConfigs: Array.isArray(g.resConfigs) ? g.resConfigs.map(String) : undefined,
    permissions: Array.isArray(g.permissions) ? g.permissions.map(String) : undefined,
  };

  return { anchors: coerced, issues };
}

/* ---------- required/defaults checking ---------- */

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

  // 额外：resConfigs/permissions 默认
  if (!Array.isArray(doc.gradle.resConfigs) && Array.isArray(def.gradle?.resConfigs)) {
    doc.gradle.resConfigs = def.gradle!.resConfigs;
  }
  if (!Array.isArray(doc.gradle.permissions) && Array.isArray(def.gradle?.permissions)) {
    doc.gradle.permissions = def.gradle!.permissions;
  }

  const ok = report.missing.length === 0;
  return { ok, report, doc };
}

/* ---------- main orchestrate ---------- */

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
      required: {
        text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
        list: ["ROUTES"],
        gradle: ["applicationId"],
      },
      defaults: {
        text: {
          "NDJC:PACKAGE_NAME": "com.ndjc.demo.core",
          "NDJC:APP_LABEL": "NDJC App",
          "NDJC:HOME_TITLE": "Home",
          "NDJC:PRIMARY_BUTTON_TEXT": "Start",
        },
        list: { ROUTES: ["home"] },
        gradle: { resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] },
      },
    };

  let appName = input.appName || reg.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App";
  let homeTitle = input.homeTitle || reg.defaults?.text?.["NDJC:HOME_TITLE"] || "Home";
  let mainButtonText = input.mainButtonText || reg.defaults?.text?.["NDJC:PRIMARY_BUTTON_TEXT"] || "Start";
  let packageId = ensurePackageId(
    input.packageId || input.packageName || reg.defaults?.text?.["NDJC:PACKAGE_NAME"],
    "com.ndjc.demo.core"
  );

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);
  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = (input.template as any) || reg.template || "circle-basic";

  let _trace: any | null = { retries: [] };

  // Build skeleton and system prompt (from file or fallback builder)
  const skeleton = buildSkeletonFromRegistry(reg, { appName, packageId, locales });
  const sysFile = process.env.NDJC_PROMPT_SYSTEM_FILE || "lib/ndjc/prompts/contract_v1.en.json";
  let system = (await loadSystemPromptFromFile(sysFile)) || "";
  if (system) {
    system = renderSystemPromptTemplate(system, reg, skeleton);
  } else {
    // fallback inline system prompt
    const allowText = reg.text.join(", ");
    const allowBlock = withPrefix("BLOCK", reg.block).join(", ");
    const allowList = withPrefix("LIST", reg.list).join(", ");
    const allowIf = withPrefix("IF", reg.if).join(", ");
    const allowHook = withPrefix("HOOK", reg.hook).join(", ");

    const lines: string[] = [];
    lines.push(`You are NDJC's contract generator. Output raw JSON only (no Markdown fences). Template: ${reg.template}`);
    lines.push(`Allowed canonical keys:`);
    lines.push(`- Text: ${allowText}`);
    lines.push(`- Block: ${allowBlock}`);
    lines.push(`- List: ${allowList}`);
    lines.push(`- If: ${allowIf}`);
    lines.push(`- Hook: ${allowHook}`);
    lines.push(`Required: text=[${(reg.required?.text || []).join(", ")}], list=[${(reg.required?.list || []).join(", ")}], gradle=[${(reg.required?.gradle || []).join(", ")}]`);
    lines.push(`Defaults: text=${JSON.stringify(reg.defaults?.text || {})}, list=${JSON.stringify(reg.defaults?.list || {})}, gradle=${JSON.stringify(reg.defaults?.gradle || {})}`);
    lines.push(buildTypeContractText(reg));
    lines.push(`SKELETON:\n${JSON.stringify(skeleton, null, 2)}`);
    system = lines.join("\n");
  }

  const baseUser = [
    `Strictly fill every field in the SKELETON without adding/removing keys.`,
    `If data is missing, use the declared defaults. Return raw JSON only.`,
    input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``,
  ]
    .filter(Boolean)
    .join("\n");

  const retryFile = process.env.NDJC_PROMPT_RETRY_FILE || "lib/ndjc/prompts/contract_v1.retry.en.txt";
  const retryTemplate = (await loadTextFileMaybe(retryFile)) || `The previous JSON violated constraints.\nMissing/invalid:\n{{ISSUES}}\nPlease fix and return the full JSON again (same keys as SKELETON).`;

  // Generate + validate + retry loop
  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: system },
        { role: "user", content: baseUser },
      ];
      if (attempt > 0 && lastText) {
        msgs.push({ role: "assistant", content: lastText });
      }
      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      // 归一化 + 类型校验&纠偏 + 必填/defaults
      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const { anchors: coerced, issues: typeIssues } = validateAndCoerce(normalized, reg);
      const { ok, report, doc } = applyDefaultsAndCheckRequired(
        { ...coerced, gradle: maybe?.anchors?.gradle || maybe?.gradle || coerced.gradle || {} },
        reg
      );

      parsed = {
        metadata: maybe?.metadata || {},
        anchors: doc,
        _raw: maybe,
        _text: text,
        _report: report,
        _typeIssues: typeIssues,
        _ok: ok,
      };

      const problems = [
        ...typeIssues,
        ...(report.missing || []),
      ];
      _trace.retries.push({ attempt, ok, typeIssues, missing: report.missing });

      if (ok) break;

      if (attempt < maxRetries) {
        const feedback = retryTemplate.replace("{{ISSUES}}", problems.map((s) => `- ${s}`).join("\n") || "- (unspecified)");
        // 覆盖 baseUser，用“纠偏指令”再来一轮
        const rr = await callGroqChat(
          [
            { role: "system", content: system },
            { role: "assistant", content: lastText },
            { role: "user", content: feedback },
          ],
          { json: true, temperature: 0 }
        );
        const text2 = typeof rr === "string" ? rr : (rr as any)?.text ?? "";
        lastText = text2;
        const maybe2 = parseJsonSafely(text2) as any;

        const normalized2 = normalizeAnchorsUsingRegistry(maybe2?.anchors || maybe2?.anchorsGrouped || {}, reg);
        const { anchors: coerced2, issues: typeIssues2 } = validateAndCoerce(normalized2, reg);
        const { ok: ok2, report: report2, doc: doc2 } = applyDefaultsAndCheckRequired(
          { ...coerced2, gradle: maybe2?.anchors?.gradle || maybe2?.gradle || coerced2.gradle || {} },
          reg
        );

        parsed = {
          metadata: maybe2?.metadata || {},
          anchors: doc2,
          _raw: maybe2,
          _text: text2,
          _report: report2,
          _typeIssues: typeIssues2,
          _ok: ok2,
        };
        _trace.retries.push({ attempt: attempt + 0.5, ok: ok2, typeIssues: typeIssues2, missing: report2.missing });

        if (ok2) break;
      }
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

  // 兜底：若必须 v1 且完全无返回，则合成最小 v1
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
        list: { ROUTES: ["home"] },
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
    _trace.registryUsed = !!reg;
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
