import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/* ----------------- types ----------------- */

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

/* ----------------- helpers: general ----------------- */

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

async function loadFileTextMaybeJSON(filePath?: string): Promise<string | null> {
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    // 尝试按 JSON 解析，若含有 { instruction } 字段，用 instruction
    try {
      const j = JSON.parse(raw);
      if (j && typeof j.instruction === "string") return j.instruction;
    } catch {
      /* ignore */
    }
    return raw;
  } catch {
    return null;
  }
}

async function loadRegistry(): Promise<Registry | null> {
  const root = process.cwd();
  const hint =
    process.env.NDJC_REGISTRY_FILE ||
    process.env.REGISTRY_FILE ||
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

/* ----------------- skeleton & prompts ----------------- */

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
  for (const k of reg.list) list[k] = (defList[k] ?? []);

  const iff: Record<string, boolean> = {};
  for (const k of reg.if) iff[k] = false;

  const hook: Record<string, string> = {};
  for (const k of reg.hook) hook[k] = "";

  const gradle = {
    applicationId: seed.packageId || defGradle.applicationId || "",
    resConfigs: seed.locales.length ? seed.locales : (defGradle.resConfigs || []),
    permissions: defGradle.permissions || []
  };

  return {
    metadata: { template: reg.template, appName: seed.appName, packageId: seed.packageId, mode: "B" },
    anchors: { text, block, list, if: iff, hook, gradle },
    files: [] as any[]
  };
}

function fallbackSystemFromRegistry(reg: Registry): string {
  const allowText = reg.text;
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList  = withPrefix("LIST",  reg.list);
  const allowIf    = withPrefix("IF",    reg.if);
  const allowHook  = withPrefix("HOOK",  reg.hook);
  const required = {
    text: reg.required?.text || [],
    list: reg.required?.list || [],
    block: reg.required?.block || [],
    if: reg.required?.if || [],
    hook: reg.required?.hook || [],
    gradle: reg.required?.gradle || []
  };
  const defaults = reg.defaults || {};
  return [
    `You are NDJC assistant. Output STRICT JSON only (no code fences).`,
    `Template: ${reg.template}`,
    `Allowed anchor keys ONLY (canonical names):`,
    `- Text: ${allowText.join(", ")}`,
    `- Block: ${allowBlock.join(", ")}`,
    `- List: ${allowList.join(", ")}`,
    `- If: ${allowIf.join(", ")}`,
    `- Hook: ${allowHook.join(", ")}`,
    `Required keys:`,
    `- text.required: ${required.text.join(", ") || "(none)"}`,
    `- list.required: ${required.list.join(", ") || "(none)"}`,
    `- gradle.required: ${required.gradle.join(", ") || "(none)"}`,
    `Defaults to use when info missing:`,
    `- text.defaults: ${JSON.stringify(defaults.text || {})}`,
    `- list.defaults: ${JSON.stringify(defaults.list || {})}`,
    `- gradle.defaults: ${JSON.stringify(defaults.gradle || {})}`,
    `Return Contract v1 JSON and make sure the key-set exactly matches the provided SKELETON.`
  ].join("\n");
}

function interpolate(str: string, vars: Record<string, string>): string {
  if (!str) return str;
  let out = str;
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`{{\\s*${k}\\s*}}`, "g");
    out = out.replace(re, v);
  }
  return out;
}

/* ----------------- alias & normalization ----------------- */

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // 最小宽松推断（基本不会触发，因为我们“表单锁死”）
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

  out.text  = filterDict(out.text,  keep.text);
  out.block = filterDict(out.block, keep.block);
  out.list  = filterDict(out.list,  keep.list);
  out.if    = filterDict(out.if,    keep.if);
  out.hook  = filterDict(out.hook,  keep.hook);

  return out;
}

/* ----------------- value-format validation ----------------- */

function isPlaceholderLike(s: string): boolean {
  const v = (s || "").trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  if (["n/a", "na", "none", "null", "undefined", "tbd", "todo", "example", "sample", "placeholder"].includes(lower)) return true;
  if (/^\{\{.+\}\}$/.test(v)) return true; // {{var}}
  if (/^lorem(?:\s|$)/i.test(v)) return true;
  if (v === "{}" || v === "[]") return true;
  if (/^<!--.*-->$/.test(v)) return true;
  return false;
}

function looksLikeCodeOrXml(s: string): boolean {
  const v = (s || "").trim();
  if (v.length < 4) return false;
  if (v.startsWith("<") && v.endsWith(">")) return true;          // XML-ish
  if (/^(import |class |object |fun |val |var |dependencies\s*\{)/m.test(v)) return true; // Kotlin/Gradle hint
  if (/^\/\/|\/\*|\*\/|<!--/.test(v)) return true;                // comment markers often around code blocks
  return false; // allow normal text too; we just don't want empty/placeholder
}

type ValidationReport = {
  missing: string[];
  badFormat: string[];
  filledByDefault: { text: string[]; list: string[]; gradle: string[] };
};

function validateAndFill(doc: any, reg: Registry): { ok: boolean; report: ValidationReport; doc: any } {
  const req = reg.required || {};
  const def = reg.defaults || {};
  const report: ValidationReport = { missing: [], badFormat: [], filledByDefault: { text: [], list: [], gradle: [] } };

  // ensure containers
  doc.text  = doc.text  || {};
  doc.list  = doc.list  || {};
  doc.block = doc.block || {};
  doc.if    = doc.if    || {};
  doc.hook  = doc.hook  || {};
  doc.gradle = doc.gradle || {};

  // text: string & non-placeholder
  for (const k of reg.text) {
    const cur = doc.text[k];
    if (req.text?.includes(k)) {
      if (typeof cur !== "string" || isPlaceholderLike(cur)) {
        const dv = def.text?.[k];
        if (typeof dv === "string" && !isPlaceholderLike(dv)) {
          doc.text[k] = dv;
          report.filledByDefault.text.push(k);
        } else {
          report.missing.push(`text:${k}`);
        }
      }
    } else if (cur != null && typeof cur !== "string") {
      report.badFormat.push(`text:${k}:must-string`);
      doc.text[k] = String(cur ?? "");
    }
  }

  // list: string[]
  for (const k of reg.list) {
    const cur = doc.list[k];
    const asArr = Array.isArray(cur) ? cur.map(String).filter((s) => !isPlaceholderLike(s)) : [];
    if (req.list?.includes(k)) {
      if (asArr.length === 0) {
        const dv = def.list?.[k] || [];
        if (dv.length) {
          doc.list[k] = dv;
          report.filledByDefault.list.push(k);
        } else {
          report.missing.push(`list:${k}`);
        }
      } else {
        doc.list[k] = asArr;
      }
    } else {
      doc.list[k] = asArr; // normalize
    }
  }

  // if: boolean
  for (const k of reg.if) {
    const cur = doc.if[k];
    if (typeof cur !== "boolean") {
      // not required, but normalize
      doc.if[k] = !!cur;
    }
  }

  // block/hook: non-empty string (not placeholder)
  for (const k of reg.block) {
    const cur = doc.block[k];
    if (cur == null) continue; // optional unless在 required.block 中
    const s = String(cur);
    if (req.block?.includes(k)) {
      if (isPlaceholderLike(s)) {
        report.missing.push(`block:${k}`);
      }
    } else if (isPlaceholderLike(s)) {
      // 留空也可，但如果模型给了占位符，提示为 badFormat 以便重试修正
      report.badFormat.push(`block:${k}:placeholder`);
    }
    // 允许代码/XML/普通文字，不强制 looksLikeCodeOrXml，只要非占位
  }
  for (const k of reg.hook) {
    const cur = doc.hook[k];
    if (cur == null) continue;
    const s = String(cur);
    if (req.hook?.includes(k)) {
      if (isPlaceholderLike(s)) {
        report.missing.push(`hook:${k}`);
      }
    } else if (isPlaceholderLike(s)) {
      report.badFormat.push(`hook:${k}:placeholder`);
    }
  }

  // gradle required (applicationId etc.)
  if (req.gradle?.includes("applicationId")) {
    let appId =
      doc.gradle.applicationId ||
      doc.text["NDJC:PACKAGE_NAME"] ||
      reg.defaults?.text?.["NDJC:PACKAGE_NAME"] ||
      reg.defaults?.gradle?.applicationId ||
      "";
    appId = ensurePackageId(appId, "com.ndjc.demo.core");
    if (!appId) report.missing.push("gradle:applicationId");
    else {
      doc.gradle.applicationId = appId;
      if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId;
      report.filledByDefault.gradle.push("applicationId");
    }
  }
  // normalize gradle extras
  if (!Array.isArray(doc.gradle.resConfigs) && Array.isArray(reg.defaults?.gradle?.resConfigs)) {
    doc.gradle.resConfigs = reg.defaults!.gradle!.resConfigs;
    report.filledByDefault.gradle.push("resConfigs");
  }
  if (!Array.isArray(doc.gradle.permissions) && Array.isArray(reg.defaults?.gradle?.permissions)) {
    doc.gradle.permissions = reg.defaults!.gradle!.permissions;
    report.filledByDefault.gradle.push("permissions");
  }

  const ok = report.missing.length === 0 && report.badFormat.length === 0;
  return { ok, report, doc };
}

/* ----------------- main orchestrate ----------------- */

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

  // ---------- load external prompts (system & retry) ----------
  const systemFile = process.env.NDJC_PROMPT_SYSTEM_FILE || "lib/ndjc/prompts/contract_v1.en.json";
  const retryFile  = process.env.NDJC_PROMPT_RETRY_FILE  || "lib/ndjc/prompts/contract_v1.retry.en.txt";
  const systemRaw  = (await loadFileTextMaybeJSON(systemFile)) || "";
  const retryRaw   = (await loadFileTextMaybeJSON(retryFile))  || "";

  // Build skeleton + system prompt (interpolate)
  const skeleton = buildSkeletonFromRegistry(reg, { appName, packageId, locales });
  const allowText = reg.text.join(", ");
  const allowBlock = withPrefix("BLOCK", reg.block).join(", ");
  const allowList  = withPrefix("LIST",  reg.list ).join(", ");
  const allowIf    = withPrefix("IF",    reg.if   ).join(", ");
  const allowHook  = withPrefix("HOOK",  reg.hook ).join(", ");
  const requiredText = (reg.required?.text || []).join(", ");
  const requiredList = (reg.required?.list || []).join(", ");
  const requiredGradle = (reg.required?.gradle || []).join(", ");

  const system = (systemRaw || fallbackSystemFromRegistry(reg));
  const systemInterpolated = interpolate(system, {
    TEMPLATE: reg.template,
    ALLOWED_TEXT: allowText,
    ALLOWED_BLOCK: allowBlock,
    ALLOWED_LIST: allowList,
    ALLOWED_IF: allowIf,
    ALLOWED_HOOK: allowHook,
    REQUIRED_TEXT: requiredText || "(none)",
    REQUIRED_LIST: requiredList || "(none)",
    REQUIRED_GRADLE: requiredGradle || "(none)",
    DEFAULTS_TEXT_JSON: JSON.stringify(reg.defaults?.text || {}),
    DEFAULTS_LIST_JSON: JSON.stringify(reg.defaults?.list || {}),
    DEFAULTS_GRADLE_JSON: JSON.stringify(reg.defaults?.gradle || {})
  });

  const baseUser = [
    `STRICTLY fill the following SKELETON and return **JSON only** (no explanations, no code fences).`,
    `Rules:`,
    `- Do NOT add or remove any key;`,
    `- Use defaults when info is missing;`,
    `- Types: text=string (non-placeholder), block/hook=string (non-placeholder), list=string[], if=boolean, gradle per example;`,
    `SKELETON:`,
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `Extra requirement: ${input.requirement!.trim()}` : ``)
  ].filter(Boolean).join("\n");

  // ---------- generate + validate + retry ----------
  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [
        { role: "system", content: systemInterpolated },
        { role: "user", content: baseUser }
      ];
      if (attempt > 0 && lastText) {
        msgs.push({ role: "assistant", content: lastText });
      }
      if (attempt > 0 && _trace.retries?.[attempt - 1]?.feedback) {
        const retryPrompt = interpolate(
          retryRaw ||
            "Missing:\n{{missing}}\nBad format:\n{{bad}}\nReturn full JSON again with same key-set.",
          {
            missing: (_trace.retries[attempt - 1].report?.missing || []).join("\n- "),
            bad: (_trace.retries[attempt - 1].report?.badFormat || []).join("\n- ")
          }
        );
        msgs.push({ role: "user", content: retryPrompt });
      }

      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const { ok, report, doc } = validateAndFill({ ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} }, reg);

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: ok };
      _trace.retries.push({ attempt, ok, report });

      if (ok) break;
    } catch (e: any) {
      _trace.retries.push({ attempt, error: e?.message || String(e) });
    }
  }

  // ---------- extract key values ----------
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

  // ---------- fallback minimal v1 if nothing ----------
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
        list: { "LIST:ROUTES": ["home"] },
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
