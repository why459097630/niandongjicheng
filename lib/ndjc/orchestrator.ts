import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

type Primitive = string | number | boolean | null | undefined;

type Registry = {
  template: string;
  schemaVersion?: string;
  description?: string;

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

  /** 大类默认类型/占位符/校验 */
  valueTypes?: {
    text?: { type?: "string"; allowEmpty?: boolean; placeholder?: string };
    block?: { type?: "string"; allowEmpty?: boolean; placeholder?: string };
    list?: { type?: "string[]"; allowEmpty?: boolean; placeholder?: string | string[] };
    if?: { type?: "boolean"; allowEmpty?: boolean; placeholder?: boolean };
    hook?: { type?: "string"; allowEmpty?: boolean; placeholder?: string };
    resources?: { type?: "base64|string"; allowEmpty?: boolean; placeholder?: string };
    gradle?: {
      applicationId?: { type?: "string"; pattern?: string; placeholder?: string };
      resConfigs?: { type?: "string[]"; placeholder?: string[] };
      permissions?: { type?: "string[]"; placeholder?: string[] };
    };
  };

  /** 单锚点覆盖规则 */
  fieldSchemas?: {
    text?: Record<string, { type?: "string"; enum?: string[]; pattern?: string; placeholder?: string }>;
    block?: Record<string, { type?: "string"; pattern?: string; placeholder?: string }>;
    list?: Record<string, { type?: "string[]"; minItems?: number; placeholder?: string[] }>;
    if?: Record<string, { type?: "boolean"; placeholder?: boolean }>;
    hook?: Record<string, { type?: "string"; placeholder?: string }>;
    resources?: Record<string, { type?: "base64|string"; placeholder?: string }>;
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

/* ----------------- helpers ----------------- */

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
      kind: it.kind || "txt"
    });
  }
  return out;
}

async function loadTextFileMaybe(p?: string): Promise<string | null> {
  if (!p) return null;
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
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

function withPrefix(kind: "BLOCK" | "LIST" | "IF" | "HOOK", xs: string[]): string[] {
  return (xs || []).map((k) => `${kind}:${k}`);
}

/** 读取 valueTypes/fieldSchemas 的占位符 */
function getPlaceholder(reg: Registry, group: "text" | "block" | "list" | "if" | "hook", key: string): any {
  const groupSchema: any = (reg.fieldSchemas as any)?.[group]?.[key];
  if (groupSchema && groupSchema.placeholder !== undefined) return groupSchema.placeholder;

  const vt: any = (reg.valueTypes as any)?.[group];
  if (!vt) return "";
  return vt.placeholder !== undefined ? vt.placeholder : "";
}

/** 把注册表变成可回填骨架（所有键都出现，按占位符/默认值填） */
function buildSkeletonFromRegistry(reg: Registry, seed: {
  appName: string; packageId: string; locales: string[];
}) {
  const defText = reg.defaults?.text || {};
  const defList = reg.defaults?.list || {};
  const defGradle = reg.defaults?.gradle || {};

  const text: Record<string, string> = {};
  for (const k of reg.text) {
    if (k === "NDJC:APP_LABEL") text[k] = seed.appName || defText[k] || String(getPlaceholder(reg, "text", k) ?? "");
    else if (k === "NDJC:PACKAGE_NAME") text[k] = seed.packageId || defText[k] || String(getPlaceholder(reg, "text", k) ?? "");
    else text[k] = defText[k] ?? String(getPlaceholder(reg, "text", k) ?? "");
  }

  const block: Record<string, string> = {};
  for (const k of reg.block) block[k] = defText[k as any] ?? String(getPlaceholder(reg, "block", k) ?? "");

  const list: Record<string, string[]> = {};
  for (const k of reg.list) {
    const dv = defList[k];
    if (Array.isArray(dv)) list[k] = dv;
    else {
      const ph = getPlaceholder(reg, "list", k);
      list[k] = Array.isArray(ph) ? ph : [];
    }
  }

  const iff: Record<string, boolean> = {};
  for (const k of reg.if) {
    const vt = (reg.fieldSchemas?.if && reg.fieldSchemas.if[k]) || undefined;
    const ph = vt?.placeholder ?? (reg.valueTypes?.if?.placeholder ?? false);
    iff[k] = Boolean(ph);
  }

  const hook: Record<string, string> = {};
  for (const k of reg.hook) hook[k] = String(getPlaceholder(reg, "hook", k) ?? "");

  const gradle = {
    applicationId:
      seed.packageId ||
      defGradle.applicationId ||
      (reg.valueTypes?.gradle?.applicationId?.placeholder ?? "com.example.app"),
    resConfigs: seed.locales.length ? seed.locales : (defGradle.resConfigs || reg.valueTypes?.gradle?.resConfigs?.placeholder || []),
    permissions: defGradle.permissions || reg.valueTypes?.gradle?.permissions?.placeholder || []
  };

  return {
    metadata: { template: reg.template, appName: seed.appName, packageId: seed.packageId, mode: "B" },
    anchors: { text, block, list, if: iff, hook, gradle },
    files: [] as any[]
  };
}

function buildSystemPrompt(reg: Registry, renderedSchema: string): string {
  const allowText = reg.text;
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList = withPrefix("LIST", reg.list);
  const allowIf = withPrefix("IF", reg.if);
  const allowHook = withPrefix("HOOK", reg.hook);

  const lines: string[] = [];
  lines.push(`You are NDJC's contract generator for building **native Android APKs**.`);
  lines.push(`Return **pure JSON**. No markdown fences, no comments.`);
  lines.push(`Only use these canonical keys (no alias, no extra, no missing):`);
  lines.push(`- Text: ${allowText.join(", ")}`);
  lines.push(`- Block: ${allowBlock.join(", ")}`);
  lines.push(`- List: ${allowList.join(", ")}`);
  lines.push(`- If: ${allowIf.join(", ")}`);
  lines.push(`- Hook: ${allowHook.join(", ")}`);
  if (reg.resources?.length) lines.push(`- Resources: ${reg.resources.join(", ")}`);
  lines.push(`Value-format rules & placeholders (for all anchors) follow. If a requirement does NOT need a key, **still fill it** with the placeholder for its type.`);
  lines.push(`=== VALUE RULES BEGIN ===`);
  lines.push(renderedSchema);
  lines.push(`=== VALUE RULES END ===`);
  lines.push(`Output must be a valid **Contract v1** JSON. Keys and structure must exactly match the SKELETON I provide.`);
  return lines.join("\n");
}

function renderRulesForPrompt(reg: Registry): string {
  const safeJson = (v: any) => JSON.stringify(v);
  const blocks: string[] = [];
  const emitGroup = (group: "text" | "block" | "list" | "if" | "hook") => {
    const keys = (reg as any)[group] as string[];
    const vt = (reg.valueTypes as any)?.[group] || {};
    blocks.push(`GROUP ${group.toUpperCase()}: type=${vt.type || (group === "if" ? "boolean" : group === "list" ? "string[]" : "string")}, placeholder=${safeJson(vt.placeholder ?? null)}`);
    const fs = (reg.fieldSchemas as any)?.[group] || {};
    for (const k of keys) {
      const rule = fs[k];
      if (rule) blocks.push(` - ${k}: ${safeJson(rule)}`);
    }
  };
  emitGroup("text");
  emitGroup("block");
  emitGroup("list");
  emitGroup("if");
  emitGroup("hook");
  if (reg.valueTypes?.gradle) {
    blocks.push(`GRADLE: ${safeJson(reg.valueTypes.gradle)}`);
  }
  return blocks.join("\n");
}

/* ---------- alias & prefix normalization ---------- */

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
    hook: new Set(reg.hook)
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

/* ---------- required/defaults + 类型校验 ---------- */

function applyDefaults(doc: any, reg: Registry) {
  doc.text = doc.text || {};
  doc.block = doc.block || {};
  doc.list = doc.list || {};
  doc.if = doc.if || {};
  doc.hook = doc.hook || {};
  doc.gradle = doc.gradle || {};

  const def = reg.defaults || {};
  for (const k of reg.text) if (!doc.text[k] && def.text?.[k] != null) doc.text[k] = def.text![k];
  for (const k of reg.list) if ((!doc.list[k] || !Array.isArray(doc.list[k])) && def.list?.[k]) doc.list[k] = def.list![k];
  if (reg.defaults?.gradle) {
    const g = reg.defaults.gradle;
    if (doc.gradle.applicationId == null && g.applicationId != null) doc.gradle.applicationId = g.applicationId;
    if (!Array.isArray(doc.gradle.resConfigs) && Array.isArray(g.resConfigs)) doc.gradle.resConfigs = g.resConfigs;
    if (!Array.isArray(doc.gradle.permissions) && Array.isArray(g.permissions)) doc.gradle.permissions = g.permissions;
  }
}

function typeCheckAndFillPlaceholders(doc: any, reg: Registry) {
  const report = { fixed: [] as string[], violations: [] as string[] };

  const vt = reg.valueTypes || {};
  const fs = reg.fieldSchemas || {};

  // text
  for (const k of reg.text) {
    let v = doc.text?.[k];
    const rule = fs.text?.[k];
    if (typeof v !== "string" || v === "") {
      v = rule?.placeholder ?? vt.text?.placeholder ?? "";
      doc.text[k] = String(v);
      report.fixed.push(`text:${k}`);
    }
    if (rule?.enum && !rule.enum.includes(doc.text[k])) {
      doc.text[k] = rule.placeholder ?? doc.text[k];
      report.violations.push(`text:${k}:enum`);
    }
    if (rule?.pattern) {
      const re = new RegExp(rule.pattern);
      if (!re.test(doc.text[k])) {
        doc.text[k] = rule.placeholder ?? doc.text[k];
        report.violations.push(`text:${k}:pattern`);
      }
    }
  }

  // block
  for (const k of reg.block) {
    let v = doc.block?.[k];
    if (typeof v !== "string") {
      v = (fs.block?.[k]?.placeholder ?? vt.block?.placeholder ?? `<!-- ${k} -->`);
      if (!doc.block) doc.block = {};
      doc.block[k] = String(v);
      report.fixed.push(`block:${k}`);
    }
  }

  // list
  for (const k of reg.list) {
    let v = doc.list?.[k];
    const rule = fs.list?.[k];
    if (!Array.isArray(v)) {
      v = rule?.placeholder ?? (Array.isArray(vt.list?.placeholder) ? vt.list?.placeholder : []);
      if (!doc.list) doc.list = {};
      doc.list[k] = Array.isArray(v) ? v.map(String) : [];
      report.fixed.push(`list:${k}`);
    }
    const min = rule?.minItems ?? 0;
    if (doc.list[k].length < min) {
      const pad = rule?.placeholder ?? [];
      doc.list[k] = (doc.list[k] as string[]).concat(pad).slice(0, Math.max(min, (doc.list[k] as string[]).length));
      report.violations.push(`list:${k}:min`);
    }
  }

  // if
  for (const k of reg.if) {
    let v = doc.if?.[k];
    if (typeof v !== "boolean") {
      v = fs.if?.[k]?.placeholder ?? vt.if?.placeholder ?? false;
      if (!doc.if) doc.if = {};
      doc.if[k] = Boolean(v);
      report.fixed.push(`if:${k}`);
    }
  }

  // hook
  for (const k of reg.hook) {
    let v = doc.hook?.[k];
    if (typeof v !== "string") {
      v = fs.hook?.[k]?.placeholder ?? vt.hook?.placeholder ?? `// ${k}`;
      if (!doc.hook) doc.hook = {};
      doc.hook[k] = String(v);
      report.fixed.push(`hook:${k}`);
    }
  }

  // gradle
  doc.gradle = doc.gradle || {};
  const appRule = vt.gradle?.applicationId;
  if (typeof doc.gradle.applicationId !== "string" || !doc.gradle.applicationId) {
    doc.gradle.applicationId = appRule?.placeholder ?? "com.example.app";
    report.fixed.push("gradle:applicationId");
  }
  if (appRule?.pattern) {
    const re = new RegExp(appRule.pattern);
    if (!re.test(doc.gradle.applicationId)) {
      doc.gradle.applicationId = ensurePackageId(doc.gradle.applicationId, appRule.placeholder || "com.example.app");
      report.violations.push("gradle:applicationId:pattern");
    }
  }
  if (!Array.isArray(doc.gradle.resConfigs)) doc.gradle.resConfigs = vt.gradle?.resConfigs?.placeholder || ["en"];
  if (!Array.isArray(doc.gradle.permissions)) doc.gradle.permissions = vt.gradle?.permissions?.placeholder || [];

  return report;
}

function checkRequired(doc: any, reg: Registry) {
  const req = reg.required || {};
  const missing: string[] = [];

  for (const k of req.text || []) if (!doc.text?.[k]) missing.push(`text:${k}`);
  for (const k of req.block || []) if (!doc.block?.[k]) missing.push(`block:${k}`);
  for (const k of req.list || []) if (!Array.isArray(doc.list?.[k]) || doc.list[k].length === 0) missing.push(`list:${k}`);
  for (const k of req.if || []) if (typeof doc.if?.[k] !== "boolean") missing.push(`if:${k}`);
  for (const k of req.hook || []) if (!doc.hook?.[k]) missing.push(`hook:${k}`);
  for (const k of req.gradle || []) if (doc.gradle?.[k] == null || doc.gradle[k] === "") missing.push(`gradle:${k}`);

  return missing;
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg =
    (await loadRegistry()) as Registry;

  // 基础参数
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

  let _trace: any | null = { retries: [] };

  // 渲染规则 & SKELETON
  const renderedRules = renderRulesForPrompt(reg);
  const skeleton = buildSkeletonFromRegistry(reg, { appName, packageId, locales });

  // 可选：外部提示词模板（系统/重试）
  const sysFile = process.env.NDJC_PROMPT_SYSTEM_FILE || path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.en.json");
  const retryFile = process.env.NDJC_PROMPT_RETRY_FILE || path.join(process.cwd(), "lib/ndjc/prompts/contract_v1.retry.en.txt");
  const sysTemplate = await loadTextFileMaybe(sysFile);
  const retryTemplate = await loadTextFileMaybe(retryFile);

  const system = sysTemplate
    ? sysTemplate
        .replace("{{TEMPLATE}}", reg.template || "circle-basic")
        .replace("{{CANONICAL_TEXT}}", reg.text.join(", "))
        .replace("{{CANONICAL_BLOCK}}", withPrefix("BLOCK", reg.block).join(", "))
        .replace("{{CANONICAL_LIST}}", withPrefix("LIST", reg.list).join(", "))
        .replace("{{CANONICAL_IF}}", withPrefix("IF", reg.if).join(", "))
        .replace("{{CANONICAL_HOOK}}", withPrefix("HOOK", reg.hook).join(", "))
        .replace("{{VALUE_RULES}}", renderedRules)
    : buildSystemPrompt(reg, renderedRules);

  const userPrompt = [
    `Fill the following SKELETON strictly. Do NOT add/remove keys. If not applicable, use the placeholder already implied by rules.`,
    input.requirement?.trim() ? `Extra requirements:\n${input.requirement!.trim()}` : ``,
    `SKELETON:`,
    JSON.stringify(skeleton, null, 2)
  ].filter(Boolean).join("\n");

  // 生成 + 校验→重试
  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [
        { role: "system", content: system },
        { role: "user", content: userPrompt }
      ];

      if (attempt > 0) {
        if (lastText) {
          msgs.push({ role: "assistant", content: lastText });
        }
        const retryMsg = retryTemplate
          ? retryTemplate
              .replace("{{MISSING}}", (_trace.retries[attempt - 1]?.missing || []).join(", "))
              .replace("{{HINT}}", "Respect all value formats & placeholders.")
          : "Previous output violated required keys/format. Fix strictly and resend full JSON.";
        msgs.push({ role: "user", content: retryMsg });
      }

      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const doc = { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} };

      applyDefaults(doc, reg);
      const typeReport = typeCheckAndFillPlaceholders(doc, reg);
      const missing = checkRequired(doc, reg);

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _typeReport: typeReport, _missing: missing, _ok: missing.length === 0 };
      _trace.retries.push({ attempt, ok: parsed._ok, missing, typeReport });

      if (parsed._ok) break;
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
          "NDJC:PRIMARY_BUTTON_TEXT": mainButtonText
        },
        block: {},
        list: { "ROUTES": ["home"] },
        if: {},
        hook: {},
        gradle: { applicationId: packageId, resConfigs: locales, permissions }
      },
      files: allowCompanions ? companions : []
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
    _trace
  };
}
