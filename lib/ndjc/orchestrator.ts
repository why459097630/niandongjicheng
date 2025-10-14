// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat } from "@/lib/ndjc/groq";

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

export type NdjcRequest = {
  run_id?: string;
  nl?: string;            // 自然语言需求
  template_key?: string;  // 例如 circle-basic
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
  template: string;
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

  // 关键：把原始文本交给上游做 pre-check
  _trace?: {
    rawText?: string;
    retries?: any[];
    source?: any;
    synthesized?: boolean;
  } | null;
};

/* ------------------- helpers ------------------- */
const ROOT = process.cwd();

function ensurePackageId(input?: string, fallback = "com.ndjc.demo.core") {
  let v = (input || "").trim();
  if (!v) return fallback;
  v = v.replace(/[^a-zA-Z0-9_.]+/g, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
  if (!v) return fallback;
  return v.toLowerCase();
}

function normalizeLocales(locales?: string[]) {
  const arr = (locales || []).map((s) => (s || "").trim()).filter(Boolean);
  return arr.length ? arr : ["en", "zh-rCN", "zh-rTW"];
}
function localesToResConfigs(locales: string[]) {
  return locales.join(",");
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
    path.join(ROOT, "lib/ndjc/anchors/registry.circle-basic.json");
  try {
    const buf = await fs.readFile(hint, "utf8");
    const json = JSON.parse(buf) as Registry;
    json.placeholders ??= { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} };
    json.valueFormat ??= { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} };
    console.log(
      `[NDJC:orchestrator] registry loaded: %s (text:%d, block:%d, list:%d, if:%d, hook:%d)`,
      hint, json.text?.length ?? 0, json.block?.length ?? 0, json.list?.length ?? 0, json.if?.length ?? 0, json.hook?.length ?? 0
    );
    return json;
  } catch (e: any) {
    console.warn(`[NDJC:orchestrator] registry load failed: ${e?.message}`);
    return null;
  }
}

async function loadPromptPair() {
  const sysPath = process.env.NDJC_PROMPT_SYSTEM_FILE || path.join(ROOT, "lib/ndjc/prompts/contract_v1.en.json");
  const rtyPath = process.env.NDJC_PROMPT_RETRY_FILE || path.join(ROOT, "lib/ndjc/prompts/contract_v1.retry.en.txt");

  const sys = await readTextAndHash(sysPath).catch(() => null);
  const rty = await readTextAndHash(rtyPath).catch(() => null);

  let systemText = sys?.raw || "";
  try {
    const j = JSON.parse(systemText);
    if (j && typeof j.system === "string") systemText = j.system;
  } catch {}

  console.log(`[NDJC:orchestrator] system prompt loaded: %s (size:%d, sha:%s)`, sys?.abs, sys?.size, sys?.sha?.slice(0, 12));
  console.log(`[NDJC:orchestrator] retry   prompt loaded: %s (size:%d, sha:%s)`, rty?.abs, rty?.size, rty?.sha?.slice(0, 12));

  return { systemText, retryText: rty?.raw || "", meta: { sys, rty } };
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

function constraintFor(group: AnchorGroup, key: string, reg: Registry): any {
  const vf = reg.valueFormat || {};
  const g = (vf as any)[group] || {};
  return (g as any)[key];
}

function placeholderFor(group: AnchorGroup, key: string, reg: Registry): any {
  const ph = reg.placeholders || {};
  const g = (ph as any)[group] || {};
  return (g as any)[key];
}

function validateValue(group: AnchorGroup, key: string, val: any, reg: Registry): { ok: boolean; reason?: string } {
  const c = constraintFor(group, key, reg);
  if (!c) return { ok: true };

  if (group === "text" || group === "block" || group === "hook" || group === "resources") {
    const s = String(val ?? "");
    if (c.minLen && s.length < c.minLen) return { ok: false, reason: `too_short(<${c.minLen})` };
    if (c.maxLen && s.length > c.maxLen) return { ok: false, reason: `too_long(>${c.maxLen})` };
    if (c.enum && Array.isArray(c.enum) && !c.enum.includes(s)) return { ok: false, reason: "enum" };
    if (c.regex && !(new RegExp(c.regex).test(s))) return { ok: false, reason: "regex" };
    return { ok: true };
  }

  if (group === "list") {
    const arr = Array.isArray(val) ? val : [];
    if (c.minItems && arr.length < c.minItems) return { ok: false, reason: "minItems" };
    if (c.maxItems && arr.length > c.maxItems) return { ok: false, reason: "maxItems" };
    if (c.itemRegex) {
      const re = new RegExp(c.itemRegex);
      for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
    }
    return { ok: true };
  }

  if (group === "if") return { ok: typeof val === "boolean" };

  if (group === "gradle") {
    if (key === "applicationId") {
      const s = String(val ?? "");
      if (c.regex && !(new RegExp(c.regex).test(s))) return { ok: false, reason: "regex" };
      return { ok: true };
    }
    if (key === "resConfigs" || key === "permissions") {
      const arr = Array.isArray(val) ? val : [];
      if (c.itemRegex) {
        const re = new RegExp(c.itemRegex);
        for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
      }
      return { ok: true };
    }
  }
  return { ok: true };
}

function enforceRequiredAndFormats(doc: any, reg: Registry) {
  const req = reg.required || {};
  const def = reg.defaults || {};
  const ph = reg.placeholders || {};
  const report = { missing: [] as string[], invalid: [] as string[] };

  doc.text ||= {}; doc.block ||= {}; doc.list ||= {}; doc.if ||= {}; doc.hook ||= {}; doc.gradle ||= {};

  for (const k of (req.text || [])) {
    let v = doc.text[k];
    if (v == null || v === "") v = def.text?.[k] ?? ph.text?.[k] ?? "";
    doc.text[k] = v;
  }
  for (const k of (req.list || [])) {
    let v = doc.list[k];
    if (!Array.isArray(v) || v.length === 0) v = def.list?.[k] ?? ph.list?.[k] ?? [];
    doc.list[k] = v;
  }
  for (const k of (req.gradle || [])) {
    if (k === "applicationId") {
      let appId =
        doc.gradle.applicationId ||
        doc.text?.["NDJC:PACKAGE_NAME"] ||
        def.text?.["NDJC:PACKAGE_NAME"] ||
        def.gradle?.applicationId ||
        ph.gradle?.applicationId;
      appId = ensurePackageId(appId, "com.ndjc.demo.core");
      doc.gradle.applicationId = appId;
      if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId;
    } else if (k === "resConfigs") {
      if (!Array.isArray(doc.gradle.resConfigs)) doc.gradle.resConfigs = def.gradle?.resConfigs ?? ph.gradle?.resConfigs ?? ["en"];
    } else if (k === "permissions") {
      if (!Array.isArray(doc.gradle.permissions)) doc.gradle.permissions = def.gradle?.permissions ?? ph.gradle?.permissions ?? [];
    }
  }

  (["text","block","list","if","hook"] as AnchorGroup[]).forEach((g) => {
    const allow = pickWhitelist(g, reg);
    for (const key of Object.keys(doc[g])) {
      if (!allow.has(key)) { delete doc[g][key]; continue; }
      const val = doc[g][key];
      const ok = validateValue(g, key, val, reg);
      if (!ok.ok) {
        report.invalid.push(`${g}:${key}`);
        const pv = placeholderFor(g, key, reg);
        doc[g][key] = g === "list" ? (Array.isArray(pv) ? pv : []) : (pv ?? (g === "if" ? false : ""));
      }
    }
  });

  if (doc.gradle) {
    for (const key of ["applicationId","resConfigs","permissions"] as const) {
      if (doc.gradle[key] == null) continue;
      const ok = validateValue("gradle", key, doc.gradle[key], reg);
      if (!ok.ok) {
        report.invalid.push(`gradle:${key}`);
        const pv = placeholderFor("gradle", key, reg);
        if (key === "applicationId") doc.gradle.applicationId = ensurePackageId(pv || "com.ndjc.demo.core", "com.ndjc.demo.core");
        else if (key === "resConfigs") doc.gradle.resConfigs = Array.isArray(pv) ? pv : ["en"];
        else if (key === "permissions") doc.gradle.permissions = Array.isArray(pv) ? pv : [];
      }
    }
  }

  return { doc, report };
}

/* ------------------- main ------------------- */
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

  const { systemText, retryText, meta } = await loadPromptPair();

  let appName = input.appName || reg.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App";
  let homeTitle = input.homeTitle || reg.defaults?.text?.["NDJC:HOME_TITLE"] || "Home";
  let mainButtonText = input.mainButtonText || reg.defaults?.text?.["NDJC:PRIMARY_BUTTON_TEXT"] || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName || reg.defaults?.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core");
  let permissions = input.permissions || [];
  let locales = normalizeLocales(input.locales);
  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = input.template_key || reg.template || "circle-basic";

  const _trace: any = {
    retries: [],
    source: {
      registry_file: process.env.NDJC_REGISTRY_FILE || "lib/ndjc/anchors/registry.circle-basic.json",
      prompt_file: meta.sys?.abs,
      prompt_sha256: meta.sys?.sha,
      retry_file: meta.rty?.abs,
      retry_sha256: meta.rty?.sha,
      model: process.env.NDJC_MODEL || "groq",
    },
  };

  // skeleton — 所有键都齐全，用于“同键返回/ JSON 约束”
  const skeleton = {
    metadata: { template, appName, packageId, mode: "B" },
    anchors: {
      text: Object.fromEntries(reg.text.map(k => [k, ""])),
      block: Object.fromEntries(reg.block.map(k => [k, ""])),
      list: Object.fromEntries(reg.list.map(k => [k, [] as string[]])),
      if: Object.fromEntries(reg.if.map(k => [k, false])),
      hook: Object.fromEntries(reg.hook.map(k => [k, ""])),
      gradle: { applicationId: packageId, resConfigs: locales, permissions },
    },
    files: [] as any[],
  };

  const baseUser = [
    "You build a native Android APK. Return STRICT JSON only.",
    "Use EXACTLY the same keys of SKELETON below. Do not add/remove keys.",
    "All anchors must be compilable / parseable. No placeholders, no empty strings.",
    `User requirement: ${input.requirement || input.nl || ""}`.trim(),
    "SKELETON:",
    JSON.stringify(skeleton, null, 2),
  ].filter(Boolean).join("\n");

  let lastText = "";
  let parsed: any = null;

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const msgs = [
      { role: "system" as const, content: systemText || "Return JSON only." },
      { role: "user" as const, content: baseUser },
    ];
    if (attempt > 0) {
      const feedback = _trace.retries?.[attempt - 1]?.feedback || "";
      msgs.push({ role: "assistant" as const, content: lastText || "" });
      msgs.push({ role: "user" as const, content: [retryText || "Fix mistakes and return JSON with the same keys.", feedback].filter(Boolean).join("\n\n") });
    }

    const r = await groqChat(msgs, { temperature: 0, top_p: 1, max_tokens: 1024 });
    lastText = r.text || "";
    // 关键：每轮都更新 rawText，确保即使失败也留存原文
    _trace.rawText = lastText;

    const maybe = parseJsonSafely(lastText);
    if (!maybe || typeof maybe !== "object") {
      _trace.retries.push({ attempt, ok: false, error: r.error || "parse_json_failed", feedback: "Return STRICT JSON with the SAME keys as SKELETON." });
      continue;
    }

    // 归一化 + 验证
    const anchors = maybe.anchors || maybe.anchorsGrouped || {};
    const normalized = {
      text: anchors.text || {},
      block: anchors.block || {},
      list: anchors.list || {},
      if: anchors.if || {},
      hook: anchors.hook || {},
      gradle: anchors.gradle || {},
    };

    const { doc, report } = enforceRequiredAndFormats(normalized, reg);
    parsed = { metadata: maybe.metadata || {}, anchors: doc, _report: report, _ok: (report.invalid.length === 0) };
    _trace.retries.push({
      attempt,
      ok: parsed._ok,
      report,
      feedback: (!parsed._ok)
        ? ["Normalize to allowed anchors only and satisfy all required keys.",
           ...(report.invalid?.length ? ["Invalid:", ...report.invalid.map((s: string) => `- ${s}`)] : []),
          ].join("\n")
        : undefined,
    });

    if (parsed._ok) break;
  }

  // 抽取关键字段
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
  const gradle = anchorsFinal?.gradle || {};
  if (Array.isArray(gradle.resConfigs)) locales = normalizeLocales(gradle.resConfigs);
  if (Array.isArray(gradle.permissions)) permissions = gradle.permissions;

  // 如果完全失败，也要把 lastText 丢给上游
  if (!parsed) {
    _trace.synthesized = true;
  }

  // 生成 XML/配置
  const permissionsXml = (permissions || []).map((p) => `<uses-permission android:name="${p}"/>`).join("\n") || undefined;
  const intentFiltersXml = input.intentHost
    ? `<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="${input.intentHost}"/>
</intent-filter>` : undefined;

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
