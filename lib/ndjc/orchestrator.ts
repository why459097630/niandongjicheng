import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** ---------------- types ---------------- */

type ValueRule =
  | { type: "string"; placeholder?: string; regex?: string; minLength?: number; enum?: string[] }
  | { type: "string[]"; placeholderItem?: string; minItems?: number }
  | { type: "boolean"; placeholder?: boolean };

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
  valueRules?: {
    text?: Record<string, ValueRule> & { ["*"]?: ValueRule };
    block?: Record<string, ValueRule> & { ["*"]?: ValueRule };
    list?: Record<string, ValueRule> & { ["*"]?: ValueRule };
    if?: Record<string, ValueRule> & { ["*"]?: ValueRule };
    hook?: Record<string, ValueRule> & { ["*"]?: ValueRule };
    gradle?: Record<string, ValueRule>;
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

async function readTextOrJsonPrompt(p?: string): Promise<string | null> {
  if (!p) return null;
  try {
    const raw = await fs.readFile(p, "utf8");
    try {
      const j = JSON.parse(raw);
      if (typeof j.prompt === "string") return j.prompt;
    } catch {
      /* not json */
    }
    return raw;
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

/** 生成回填骨架（所有规范键齐全，值先以默认/占位符填好） */
function buildSkeletonFromRegistry(
  reg: Registry,
  seed: { appName: string; packageId: string; locales: string[] }
) {
  const defText = reg.defaults?.text || {};
  const defList = reg.defaults?.list || {};
  const defGradle = reg.defaults?.gradle || {};
  const rules = reg.valueRules || {};

  const getRule = (cat: keyof Registry["valueRules"], key: string): ValueRule | undefined => {
    const g = (rules as any)?.[cat] || {};
    return (g[key] as ValueRule) || (g["*"] as ValueRule) || undefined;
  };

  const text: Record<string, string> = {};
  for (const k of reg.text) {
    const r = getRule("text", k) as Extract<ValueRule, { type: "string" }> | undefined;
    let v =
      (k === "NDJC:APP_LABEL" && (seed.appName || defText[k])) ||
      (k === "NDJC:PACKAGE_NAME" && (seed.packageId || defText[k])) ||
      defText[k] ||
      (r?.placeholder ?? "");
    text[k] = String(v ?? "");
  }

  const block: Record<string, string> = {};
  for (const k of reg.block) {
    const r = getRule("block", k) as Extract<ValueRule, { type: "string" }> | undefined;
    block[k] = String((r?.placeholder ?? "") ?? "");
  }

  const list: Record<string, string[]> = {};
  for (const k of reg.list) {
    const r = getRule("list", k) as Extract<ValueRule, { type: "string[]" }> | undefined;
    const dv = defList[k];
    if (dv && dv.length) {
      list[k] = dv.slice();
    } else {
      const item = r?.placeholderItem ?? "";
      list[k] = item ? [item] : [];
    }
  }

  const iff: Record<string, boolean> = {};
  for (const k of reg.if) {
    const r = getRule("if", k) as Extract<ValueRule, { type: "boolean" }> | undefined;
    iff[k] = (typeof r?.placeholder === "boolean" ? r!.placeholder! : false);
  }

  const hook: Record<string, string> = {};
  for (const k of reg.hook) {
    const r = getRule("hook", k) as Extract<ValueRule, { type: "string" }> | undefined;
    hook[k] = String((r?.placeholder ?? "") ?? "");
  }

  const gradle = {
    applicationId: seed.packageId || defGradle.applicationId || "com.example.app",
    resConfigs: seed.locales.length ? seed.locales : (defGradle.resConfigs || ["en"]),
    permissions: defGradle.permissions || []
  };

  return {
    metadata: { template: reg.template, appName: seed.appName, packageId: seed.packageId, mode: "B" },
    anchors: { text, block, list, if: iff, hook, gradle },
    files: [] as any[]
  };
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

  // Canonical whitelist
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

/** 校验与占位回填：按 valueRules 约束逐项检查；缺失或不合规→占位符回填，并记录 violation */
function validateAndFill(
  doc: any,
  reg: Registry
): { ok: boolean; violations: string[]; doc: any } {
  const violations: string[] = [];
  const rules = reg.valueRules || {};

  const getRule = (cat: keyof Registry["valueRules"], key: string): ValueRule | undefined => {
    const g = (rules as any)?.[cat] || {};
    return (g[key] as ValueRule) || (g["*"] as ValueRule) || undefined;
  };

  // helper: enforce one key
  const ensureString = (obj: any, k: string, r?: Extract<ValueRule, { type: "string" }>) => {
    let v = obj[k];
    if (typeof v !== "string") {
      v = r?.placeholder ?? "";
      obj[k] = v;
      violations.push(`text:${k} -> filled placeholder`);
    }
    if (r?.minLength && v.length < r.minLength) {
      obj[k] = r.placeholder ?? v;
      violations.push(`text:${k} -> minLength`);
    }
    if (r?.enum && !r.enum.includes(v)) {
      obj[k] = r.placeholder ?? (r.enum[0] ?? v);
      violations.push(`text:${k} -> enum`);
    }
    if (r?.regex) {
      try {
        const re = new RegExp(r.regex);
        if (!re.test(obj[k])) {
          obj[k] = r.placeholder ?? obj[k];
          violations.push(`text:${k} -> regex`);
        }
      } catch {
        /* ignore bad regex */
      }
    }
  };

  const ensureStringArray = (obj: any, k: string, r?: Extract<ValueRule, { type: "string[]" }>) => {
    let v = obj[k];
    if (!Array.isArray(v)) v = [];
    v = v.map((x: any) => String(x));
    if ((r?.minItems ?? 0) > 0 && v.length < (r!.minItems!)) {
      const toAdd = (r!.minItems! - v.length);
      for (let i = 0; i < toAdd; i++) v.push(r?.placeholderItem ?? "");
      violations.push(`list:${k} -> minItems`);
    }
    if (v.length === 0 && r?.placeholderItem != null) {
      v.push(r.placeholderItem);
      violations.push(`list:${k} -> placeholderItem`);
    }
    obj[k] = v;
  };

  const ensureBoolean = (obj: any, k: string, r?: Extract<ValueRule, { type: "boolean" }>) => {
    let v = obj[k];
    if (typeof v !== "boolean") {
      obj[k] = (typeof r?.placeholder === "boolean" ? r!.placeholder! : false);
      violations.push(`if:${k} -> placeholder`);
    }
  };

  // text
  doc.text = doc.text || {};
  for (const k of reg.text) {
    const r = getRule("text", k) as Extract<ValueRule, { type: "string" }> | undefined;
    if (!(k in doc.text)) doc.text[k] = r?.placeholder ?? "";
    ensureString(doc.text, k, r);
  }

  // block
  doc.block = doc.block || {};
  for (const k of reg.block) {
    const r = getRule("block", k) as Extract<ValueRule, { type: "string" }> | undefined;
    if (!(k in doc.block)) doc.block[k] = r?.placeholder ?? "";
    ensureString(doc.block, k, r);
  }

  // list
  doc.list = doc.list || {};
  for (const k of reg.list) {
    const r = getRule("list", k) as Extract<ValueRule, { type: "string[]" }> | undefined;
    if (!(k in doc.list)) {
      const item = r?.placeholderItem ?? "";
      doc.list[k] = item ? [item] : [];
    }
    ensureStringArray(doc.list, k, r);
  }

  // if
  doc.if = doc.if || {};
  for (const k of reg.if) {
    const r = getRule("if", k) as Extract<ValueRule, { type: "boolean" }> | undefined;
    if (!(k in doc.if)) doc.if[k] = (typeof r?.placeholder === "boolean" ? r!.placeholder! : false);
    ensureBoolean(doc.if, k, r);
  }

  // hook
  doc.hook = doc.hook || {};
  for (const k of reg.hook) {
    const r = getRule("hook", k) as Extract<ValueRule, { type: "string" }> | undefined;
    if (!(k in doc.hook)) doc.hook[k] = r?.placeholder ?? "";
    ensureString(doc.hook, k, r);
  }

  // gradle
  doc.gradle = doc.gradle || {};
  const grules = rules.gradle || {};
  const ga = grules["applicationId"] as Extract<ValueRule, { type: "string" }> | undefined;
  const grc = grules["resConfigs"] as Extract<ValueRule, { type: "string[]" }> | undefined;
  const gperm = grules["permissions"] as Extract<ValueRule, { type: "string[]" }> | undefined;

  if (!("applicationId" in doc.gradle)) doc.gradle.applicationId = (ga?.placeholder ?? "com.example.app");
  ensureString(doc.gradle, "applicationId", ga);

  if (!Array.isArray(doc.gradle.resConfigs)) doc.gradle.resConfigs = [];
  ensureStringArray(doc.gradle, "resConfigs", grc);

  if (!Array.isArray(doc.gradle.permissions)) doc.gradle.permissions = [];
  ensureStringArray(doc.gradle, "permissions", gperm);

  // required presence (now they are all filled by the above; ensure again)
  const missing: string[] = [];
  const req = reg.required || {};
  for (const k of (req.text || [])) if (!(k in doc.text)) missing.push(`text:${k}`);
  for (const k of (req.list || [])) if (!(k in doc.list)) missing.push(`list:${k}`);
  for (const k of (req.block || [])) if (!(k in doc.block)) missing.push(`block:${k}`);
  for (const k of (req.if || [])) if (!(k in doc.if)) missing.push(`if:${k}`);
  for (const k of (req.hook || [])) if (!(k in doc.hook)) missing.push(`hook:${k}`);
  for (const k of (req.gradle || [])) if (!(k in doc.gradle)) missing.push(`gradle:${k}`);

  if (missing.length) violations.push(`missing:${missing.join(",")}`);

  return { ok: violations.length === 0, violations, doc };
}

function buildSystemPrompt(reg: Registry, androidNote: string): string {
  const allowText = reg.text;
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList = withPrefix("LIST", reg.list);
  const allowIf = withPrefix("IF", reg.if);
  const allowHook = withPrefix("HOOK", reg.hook);
  const lines: string[] = [];
  lines.push(androidNote);
  lines.push(`Template: ${reg.template}`);
  lines.push(`Allowed keys (canonical):`);
  lines.push(`- Text: ${allowText.join(", ")}`);
  lines.push(`- Block: ${allowBlock.join(", ")}`);
  lines.push(`- List: ${allowList.join(", ")}`);
  lines.push(`- If: ${allowIf.join(", ")}`);
  lines.push(`- Hook: ${allowHook.join(", ")}`);
  lines.push(`Return pure JSON only.`);
  return lines.join("\n");
}

/** ---------------- main ---------------- */

export async function orchestrate(input: OrchestrateInput) {
  const reg =
    (await loadRegistry()) || {
      template: "circle-basic",
      text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
      block: [],
      list: ["ROUTES"],
      if: [],
      hook: [],
      aliases: {},
      required: { text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"], list: ["ROUTES"], gradle: ["applicationId", "resConfigs", "permissions"] },
      defaults: { text: { "NDJC:PACKAGE_NAME": "com.ndjc.demo.core", "NDJC:APP_LABEL": "NDJC App", "NDJC:HOME_TITLE": "Home", "NDJC:PRIMARY_BUTTON_TEXT": "Start" }, list: { "ROUTES": ["home"] }, gradle: { applicationId: "com.ndjc.demo.core", resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] } },
      valueRules: { text: { "*": { type: "string", placeholder: "" } }, list: { "*": { type: "string[]", placeholderItem: "" } }, if: { "*": { type: "boolean", placeholder: false } }, block: { "*": { type: "string", placeholder: "<!-- NDJC:BLOCK -->" } }, hook: { "*": { type: "string", placeholder: "// NDJC:HOOK" } }, gradle: { applicationId: { type: "string", placeholder: "com.example.app" }, resConfigs: { type: "string[]", minItems: 1, placeholderItem: "en" }, permissions: { type: "string[]", placeholderItem: "" } } }
    };

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

  // Build skeleton and prompts
  const skeleton = buildSkeletonFromRegistry(reg, { appName, packageId, locales });
  const sysFromFile = await readTextOrJsonPrompt(process.env.NDJC_PROMPT_SYSTEM_FILE);
  const retryFromFile = await readTextOrJsonPrompt(process.env.NDJC_PROMPT_RETRY_FILE);
  const androidNote =
    (sysFromFile && sysFromFile.trim()) ||
    "You are generating Contract v1 JSON used to build a native Android APK. Fill every anchor; use placeholders if business need is none. Keep compilable where applicable. Output pure JSON.";

  const system = buildSystemPrompt(reg, androidNote);

  const baseUser = [
    `Strictly fill the following SKELETON keys (no add/remove). If a key is not needed, use the proper placeholder per value rules. Output JSON only.`,
    `SKELETON:`,
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``)
  ]
    .filter(Boolean)
    .join("\n");

  // Generate + validate + retry
  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs = [
        { role: "system", content: system },
        { role: "user", content: baseUser }
      ] as any[];

      if (attempt > 0 && _trace.retries?.[attempt - 1]?.feedback) {
        msgs.push({ role: "user", content: _trace.retries[attempt - 1].feedback });
      }
      if (attempt > 0 && lastText) {
        msgs.push({ role: "assistant", content: lastText });
        msgs.push({ role: "user", content: (retryFromFile || "Please correct the JSON per rules and resend full JSON.") });
      }

      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);

      // 先按 required/defaults 兜底
      const applyDefaults = (doc: any) => {
        const req = reg.required || {};
        const def = reg.defaults || {};
        doc.text = doc.text || {};
        doc.list = doc.list || {};
        doc.gradle = doc.gradle || {};
        for (const k of req.text || []) {
          if (!doc.text[k]) doc.text[k] = def.text?.[k] ?? doc.text[k] ?? "";
        }
        for (const k of req.list || []) {
          if (!Array.isArray(doc.list[k]) || doc.list[k].length === 0) {
            doc.list[k] = (def.list?.[k] ?? []);
          }
        }
        if (!doc.gradle.applicationId) {
          doc.gradle.applicationId =
            doc.text?.["NDJC:PACKAGE_NAME"] ||
            def.gradle?.applicationId ||
            "com.example.app";
        }
        if (!Array.isArray(doc.gradle.resConfigs)) {
          doc.gradle.resConfigs = def.gradle?.resConfigs || ["en"];
        }
        if (!Array.isArray(doc.gradle.permissions)) {
          doc.gradle.permissions = def.gradle?.permissions || [];
        }
        return doc;
      };

      const seeded = applyDefaults({ ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} });

      // 严格值格式校验 + 占位回填
      const { ok, violations, doc } = validateAndFill(seeded, reg);

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _violations: violations, _ok: ok };
      _trace.retries.push({
        attempt,
        ok,
        violations,
        feedback: ok
          ? undefined
          : [
              "The JSON failed value-format checks. Fix the following and resend FULL JSON:",
              ...violations.map((v: string) => `- ${v}`)
            ].join("\n")
      });

      if (ok) break;
    } catch (e: any) {
      _trace.retries.push({ attempt, error: e?.message || String(e) });
    }
  }

  // Extract final values
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

  // Safety fallback
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
