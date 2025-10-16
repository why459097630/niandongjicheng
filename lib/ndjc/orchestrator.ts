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
    gradle?: { applicationId?: string; resConfigs?: string[]; permissions?: string[] };
  };
  placeholders?: {
    text?: Record<string, string>;
    block?: Record<string, string>;
    list?: Record<string, string[]>;
    if?: Record<string, boolean>;
    hook?: Record<string, string>;
    resources?: Record<string, string>;
    gradle?: { applicationId?: string; resConfigs?: string[]; permissions?: string[] };
  };
  valueFormat?: {
    text?: Record<string, { regex?: string; enum?: string[]; minLen?: number; maxLen?: number }>;
    block?: Record<string, { minLen?: number; maxLen?: number }>;
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

// 允许从 ```json``` 样式中抽取
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
    } catch {}
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

/** ---------- 合同校验（不做值篡改） ---------- */
function containsAngleBrackets(v: any) {
  if (v == null) return false;
  return /[<>]/.test(String(v));
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
function validateValue(group: AnchorGroup, key: string, val: any, reg: Registry): { ok: boolean; reason?: string } {
  const vf = reg.valueFormat || {};
  const c = (vf as any)[group]?.[key];

  if (group === "text" || group === "block" || group === "hook" || group === "resources") {
    const s = String(val ?? "");
    if (!s.length) return { ok: false, reason: "empty" };
    if (containsAngleBrackets(s)) return { ok: false, reason: "angle_brackets" };
    if (!c) return { ok: true };
    if ((c as any).minLen && s.length < (c as any).minLen) return { ok: false, reason: `minLen` };
    if ((c as any).maxLen && s.length > (c as any).maxLen) return { ok: false, reason: `maxLen` };
    if ((c as any).enum && Array.isArray((c as any).enum) && !(c as any).enum.includes(s)) return { ok: false, reason: "enum" };
    if ((c as any).regex && !(new RegExp((c as any).regex).test(s))) return { ok: false, reason: "regex" };
    return { ok: true };
  }

  if (group === "list") {
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return { ok: false, reason: "empty_list" };
    if (!c) return { ok: true };
    if (c.minItems && arr.length < c.minItems) return { ok: false, reason: "minItems" };
    if (c.maxItems && arr.length > c.maxItems) return { ok: false, reason: "maxItems" };
    if (c.itemRegex) {
      const re = new RegExp(c.itemRegex);
      for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
    }
    return { ok: true };
  }

  if (group === "if") {
    return { ok: typeof val === "boolean" };
  }

  if (group === "gradle") {
    if (key === "applicationId") {
      const s = String(val ?? "");
      const ok = new RegExp(reg.valueFormat?.gradle?.applicationId?.regex || ".*").test(s);
      return { ok, reason: ok ? undefined : "regex" };
    }
    if (key === "resConfigs" || key === "permissions") {
      const arr = Array.isArray(val) ? val : [];
      if (!arr.length) return { ok: false, reason: "empty_list" };
      const re = reg.valueFormat?.gradle?.[key as "resConfigs"|"permissions"]?.itemRegex;
      if (re) {
        const regx = new RegExp(re);
        for (const it of arr) if (!regx.test(String(it))) return { ok: false, reason: "itemRegex" };
      }
      return { ok: true };
    }
  }
  return { ok: true };
}

function validateContractV1(maybe: any, reg: Registry) {
  const report = {
    topLevel: [] as string[],
    groups: [] as string[],
    missing: [] as string[],
    invalid: [] as string[],
    filesShape: [] as string[],
    ok: false,
  };

  // 顶层键顺序与命名
  const keys = Object.keys(maybe || {});
  const want = ["metadata","anchorsGrouped","files"];
  if (keys.length !== 3 || want.some((k, i) => keys[i] !== k)) {
    report.topLevel.push(`top-level keys/order must be ${want.join(" → ")}`);
  }

  const ag = maybe?.anchorsGrouped;
  const groupsWanted: AnchorGroup[] = ["text","block","list","if","hook","gradle"];
  if (!ag || typeof ag !== "object") {
    report.groups.push("anchorsGrouped must be an object with 6 groups");
  } else {
    for (const g of groupsWanted) {
      if (!(g in ag)) report.groups.push(`missing group: ${g}`);
    }
  }

  // 逐项锚点存在性与格式
  if (ag) {
    (["text","block","list","if","hook"] as AnchorGroup[]).forEach((g) => {
      const allow = pickWhitelist(g, reg);
      const bag = ag[g] || {};
      for (const name of allow) {
        if (!(name in bag)) {
          report.missing.push(`${g}:${name}`);
        } else {
          const v = bag[name];
          const ok = validateValue(g, name, v, reg);
          if (!ok.ok) report.invalid.push(`${g}:${name}(${ok.reason})`);
        }
      }
    });

    if (ag.gradle) {
      for (const k of ["applicationId","resConfigs","permissions"] as const) {
        if (!(k in ag.gradle)) report.missing.push(`gradle:${k}`);
        else {
          const ok = validateValue("gradle", k, ag.gradle[k], reg);
          if (!ok.ok) report.invalid.push(`gradle:${k}(${ok.reason})`);
        }
      }
    } else {
      report.groups.push("missing group: gradle");
    }
  }

  // files 必须是对象（path → content）
  if (!maybe || typeof maybe.files !== "object" || Array.isArray(maybe.files)) {
    report.filesShape.push("files must be an object mapping path → content");
  }

  report.ok = !(report.topLevel.length || report.groups.length || report.missing.length || report.invalid.length || report.filesShape.length);
  return report;
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
      placeholders: { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} },
      valueFormat: { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} }
    };

  const sysPrompt = await loadSystemPrompt();
  const rtyPrompt = await loadRetryPrompt();

  // 仅用于派生（不写回模型输出）
  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Home";
  let mainButtonText = input.mainButtonText || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName, "com.example.ndjc");

  let permissions = input.permissions || ["android.permission.INTERNET"];
  let locales = normalizeLocales(input.locales);
  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = (input.template as any) || (reg.template || "circle-basic");

  /** trace */
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

  /** 与 Playground 一致的消息载荷：system=硬约束；user=需求 + registry 原文 */
  const baseUser = [
    "Use the following inputs to produce the final NDJC Contract v1 JSON (output only the JSON object; no explanations):",
    "",
    "- {user_request}:",
    (input.requirement?.trim() ||
      "Build an Android app for a Texas restaurant; allow photo upload, rich text editing, USD price input, reviews & likes. Bilingual (EN/zh), targetSdk 34; require CAMERA, READ_MEDIA_IMAGES, INTERNET, ACCESS_NETWORK_STATE."),
    "",
    "- {registry_json}:",
    JSON.stringify(reg, null, 2),
  ].join("\n");

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

  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";
  let lastErrorStatus: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [
        { role: "system", content: sysPrompt.text || "Return JSON only." },
        { role: "user", content: baseUser },
      ];

      if (attempt > 0) {
        if (lastText) msgs.push({ role: "assistant", content: lastText });
        const prev = _trace.retries?.[attempt - 1]?.report;
        const retryText =
          (rtyPrompt.text || "").trim() ||
          "Fix mistakes and regenerate. Follow schema strictly. Fill every anchor. No placeholders, no empty strings/arrays/objects. No '<' or '>' in any string. Return JSON only.";
        const bullets: string[] = [];
        if (prev) {
          if (prev.topLevel?.length) bullets.push(`Top-level: ${prev.topLevel.join("; ")}`);
          if (prev.groups?.length) bullets.push(`Groups: ${prev.groups.join("; ")}`);
          if (prev.missing?.length) bullets.push(`Missing: ${prev.missing.join(", ")}`);
          if (prev.invalid?.length) bullets.push(`Invalid: ${prev.invalid.join(", ")}`);
          if (prev.filesShape?.length) bullets.push(`Files: ${prev.filesShape.join("; ")}`);
        }
        msgs.push({ role: "user", content: [retryText, bullets.join("\n")].filter(Boolean).join("\n\n") });
      }

      // groq.ts 内部已做 JSON Mode + 重试
      const text = await callGroqChat(msgs, { temperature: 0 });
      lastText = text;

      const maybe = parseJsonSafely(text);
      if (!maybe || typeof maybe !== "object") {
        const err = Object.assign(new Error("LLM returned non-JSON or empty text"), { status: 502 });
        _trace.retries.push({ attempt, ok: false, error: err.message });
        throw err;
      }

      const report = validateContractV1(maybe, reg);
      parsed = { maybe, report, ok: report.ok, text };
      _trace.retries.push({ attempt, report, ok: report.ok });

      if (report.ok) break;
    } catch (e: any) {
      lastErrorStatus = e?.status;
      _trace.retries.push({ attempt, error: e?.message || String(e), status: lastErrorStatus });
      if (attempt >= maxRetries) throw e; // 最终失败：交由 API 层映射 429/503
      // 进入下一轮提示式重试
    }
  }

  if (!parsed?.ok) {
    // 理论上已在上面抛出；此处留守护
    const err = Object.assign(new Error("Failed to obtain a valid NDJC Contract v1 JSON"), {
      status: lastErrorStatus || 502,
      trace: _trace,
    });
    throw err;
  }

  // 提取模型产物（不做本地篡改）
  let appName2 = appName, packageId2 = packageId, homeTitle2 = homeTitle, mainButtonText2 = mainButtonText;
  const anchorsGrouped = parsed.maybe.anchorsGrouped || {};
  if (anchorsGrouped?.text) {
    appName2 = anchorsGrouped.text["NDJC:APP_LABEL"] || appName2;
    homeTitle2 = anchorsGrouped.text["NDJC:HOME_TITLE"] || homeTitle2;
    mainButtonText2 = anchorsGrouped.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText2;
    packageId2 = ensurePackageId(anchorsGrouped.text["NDJC:PACKAGE_NAME"] || packageId2, packageId2);
  }
  const gradle = anchorsGrouped?.gradle || {};
  if (Array.isArray(gradle.resConfigs)) locales = normalizeLocales(gradle.resConfigs);
  if (Array.isArray(gradle.permissions)) permissions = gradle.permissions;

  // files：严格要求对象，当前阶段不物化 companions（保持为空或后续步骤处理）
  // 不重复声明 companions 变量，避免 TS 冲突
  const _traceOut = {
    ..._trace,
    ok: !!parsed?.ok,
    last_text_len: (parsed?.text || "").length,
    last_errors: parsed?.report && !parsed.report.ok ? parsed.report : undefined,
  };

  // 派生值（供打包管线）
  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = input.intentHost ? mkIntentFiltersXml(input.intentHost) : undefined;
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  return {
    template,
    mode,
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

    companions, // 若后续需要基于 files 物化，再在下游单独处理
    _trace: _traceOut,
  };
}
