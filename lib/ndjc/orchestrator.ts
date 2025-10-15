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

  // 白名单
  text: string[];
  block: string[];
  list: string[];
  if: string[];
  hook: string[];
  resources?: string[];

  // 别名 / 必填 / 默认
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

  // 可选：占位/格式约束（为将来扩展预留）
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
    block?: Record<string, { maxLen?: number }>;
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
    let text = raw;
    try {
      const maybe = JSON.parse(raw);
      if (maybe && typeof maybe.system === "string") text = maybe.system;
    } catch {/* treat as plain text */}
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
    return { path: hint, text: "", sha, size: 0 };
  }
}

/** ----- registry helpers ----- */
function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // 宽松推断（兜底）
  if (/^ROUTES$|FIELDS$|FLAGS$|STYLES$|PATTERNS$|PROGUARD|SPLITS|STRINGS$/i.test(k)) return `LIST:${k}`;
  if (/^PERMISSION|INTENT|NETWORK|FILE_PROVIDER/i.test(k)) return `IF:${k}`;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^DEBUG_|^BUILD_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(k)) return `BLOCK:${k}`;
  return k;
}

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

function applyWhitelistAndAliases(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };
  const groups: AnchorGroup[] = ["text", "block", "list", "if", "hook"];

  const tryAssign = (dict: any, key: string, val: any) => {
    if (key.startsWith("TEXT:")) dict.text[key.replace(/^TEXT:/, "") || key] = String(val ?? "");
    else if (key.startsWith("BLOCK:")) dict.block[key.replace(/^BLOCK:/, "") || key] = String(val ?? "");
    else if (key.startsWith("LIST:")) dict.list[key.replace(/^LIST:/, "") || key] = Array.isArray(val) ? val.map(String) : (val == null ? [] : [String(val)]);
    else if (key.startsWith("IF:")) dict.if[key.replace(/^IF:/, "") || key] = !!val;
    else if (key.startsWith("HOOK:")) dict.hook[key.replace(/^HOOK:/, "") || key] = Array.isArray(val) ? val.join("\n") : String(val ?? "");
  };

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

  (["text","block","list","if","hook"] as AnchorGroup[]).forEach((g) => {
    const allow = pickWhitelist(g, reg);
    out[g] = Object.fromEntries(Object.entries(out[g]).filter(([k]) => allow.has(k)));
  });

  return out;
}

function ensureRequiredAndDefaults(doc: any, reg: Registry) {
  const req = reg.required || {};
  const def = reg.defaults || {};

  doc.text ||= {}; doc.block ||= {}; doc.list ||= {}; doc.if ||= {}; doc.hook ||= {}; doc.gradle ||= {};

  for (const k of (req.text || [])) {
    if (doc.text[k] == null) doc.text[k] = def.text?.[k] ?? "";
  }
  for (const k of (req.list || [])) {
    const cur = doc.list[k];
    if (!Array.isArray(cur) || cur.length === 0) doc.list[k] = def.list?.[k] ?? [];
  }
  for (const k of (req.gradle || [])) {
    if (k === "applicationId") {
      let appId = doc.gradle.applicationId || doc.text?.["NDJC:PACKAGE_NAME"] || def.text?.["NDJC:PACKAGE_NAME"] || def.gradle?.applicationId;
      appId = ensurePackageId(appId, "com.ndjc.demo.core");
      doc.gradle.applicationId = appId;
      if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId;
    } else if (k === "resConfigs") {
      if (!Array.isArray(doc.gradle.resConfigs)) doc.gradle.resConfigs = def.gradle?.resConfigs ?? ["en"];
    } else if (k === "permissions") {
      if (!Array.isArray(doc.gradle.permissions)) doc.gradle.permissions = def.gradle?.permissions ?? [];
    }
  }
  return doc;
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
      defaults: { text: { "NDJC:PACKAGE_NAME": "com.ndjc.demo.core", "NDJC:APP_LABEL": "NDJC App", "NDJC:HOME_TITLE": "Home", "NDJC:PRIMARY_BUTTON_TEXT": "Start" }, list: { "ROUTES": ["home"] }, gradle: { resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] } },
      placeholders: { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} },
      valueFormat: { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} },
    };

  const sysPrompt = await loadSystemPrompt();
  const rtyPrompt = await loadRetryPrompt();

  let appName = input.appName || reg.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App";
  let homeTitle = input.homeTitle || reg.defaults?.text?.["NDJC:HOME_TITLE"] || "Home";
  let mainButtonText = input.mainButtonText || reg.defaults?.text?.["NDJC:PRIMARY_BUTTON_TEXT"] || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName || reg.defaults?.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core");

  let permissions = input.permissions || [];
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

  // SKELETON（所有键齐全）
  const skeleton = (() => {
    const text: Record<string, string> = {};
    for (const k of reg.text) {
      if (k === "NDJC:APP_LABEL") text[k] = appName || "";
      else if (k === "NDJC:HOME_TITLE") text[k] = homeTitle || "";
      else if (k === "NDJC:PRIMARY_BUTTON_TEXT") text[k] = mainButtonText || "";
      else if (k === "NDJC:PACKAGE_NAME") text[k] = packageId || "";
      else text[k] = reg.defaults?.text?.[k] ?? "";
    }
    const block: Record<string, string> = Object.fromEntries(reg.block.map((k) => [k, ""]));
    const list: Record<string, string[]> = Object.fromEntries(reg.list.map((k) => [k, reg.defaults?.list?.[k] ?? []]));
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

  // 组装 user 指令
  const baseUser = [
    "Return STRICT JSON only. Use the SAME keys of SKELETON. Do not add or remove any keys.",
    "Fill all anchors with values. If not applicable, use placeholders but keep the type.",
    "SKELETON:",
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``),
  ].filter(Boolean).join("\n");

  // 控制台确认 prompt 文件
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

  // 生成 + 校验→重试
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
        const feedback = _trace.retries?.[attempt - 1]?.feedback || "";
        const retryText =
          (rtyPrompt.text || "").trim() ||
          "Fix mistakes. Keep the same keys as SKELETON. Fill required anchors. Return JSON only.";
        msgs.push({ role: "user", content: [retryText, feedback].filter(Boolean).join("\n\n") });
      }

      // 去掉 { json: true }，统一返回文本
      const r = await callGroqChat(msgs, { temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;

      const maybe = parseJsonSafely(text) as any;
      const normalized = applyWhitelistAndAliases(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const doc = ensureRequiredAndDefaults(
        { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} },
        reg
      );

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _ok: true };
      _trace.retries.push({ attempt, ok: true });

      break; // 成功拿到一次即可
    } catch (e: any) {
      _trace.retries.push({ attempt, error: e?.message || String(e) });

      // [FIX] 如果本次调用失败，立刻给 lastText 一个可被预检解析的 JSON，避免 E_NOT_JSON
      if (!lastText) {
        lastText = JSON.stringify({ error: "llm_call_failed", skeleton });
      }
    }
  }

  // 抽取关键值（以模型产物为准）
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
  if (Array.isArray(gradle.resConfigs)) locales = normalizeLocales(gradle.resConfigs);
  if (Array.isArray(gradle.permissions)) permissions = gradle.permissions;
  if (allowCompanions && Array.isArray(parsed?._raw?.files)) companions = sanitizeCompanions(parsed._raw.files);

  // [FIX] —— 统一输出 rawText（补齐 metadata.template，强制 anchorsGrouped）
  if (!parsed || !parsed._text) {
    // 无模型文本 → 生成合规 v1
    const v1doc = {
      metadata: { runId: (input as any).runId || undefined, template, appName, packageId, mode },
      anchorsGrouped: {
        text: {
          "NDJC:PACKAGE_NAME": packageId,
          "NDJC:APP_LABEL": appName,
          "NDJC:HOME_TITLE": homeTitle,
          "NDJC:PRIMARY_BUTTON_TEXT": mainButtonText,
        },
        block: {},
        list: { "ROUTES": ["home"] },
        if: {},
        hook: {},
        gradle: { applicationId: packageId, resConfigs: locales, permissions },
      },
      files: allowCompanions ? companions : [],
    };
    _trace.synthesized = true;
    _trace.rawText = JSON.stringify(v1doc);
  } else {
    // 有模型文本 → 解析并兜底补齐
    const rawObj = parseJsonSafely(parsed._text) ?? {};
    const anchorsAny = rawObj.anchorsGrouped ?? rawObj.anchors ?? {};
    const anchorsPatched = ensureRequiredAndDefaults(
      applyWhitelistAndAliases(anchorsAny, reg),
      reg
    );
    const meta = rawObj.metadata ?? {};
    meta.template = meta.template || template;
    meta.appName = meta.appName || appName;
    meta.packageId = ensurePackageId(meta.packageId || packageId, packageId);
    meta.mode = meta.mode || mode;

    const finalRaw: any = { metadata: meta, anchorsGrouped: anchorsPatched };
    if (allowCompanions && Array.isArray(rawObj.files)) {
      finalRaw.files = sanitizeCompanions(rawObj.files);
    }
    _trace.rawText = JSON.stringify(finalRaw);
  }

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
