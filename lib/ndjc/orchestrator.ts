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
  const ph = reg.placeholders || {};
  const g = (ph as any)[group] || {};
  return (g as any)[key];
}

function constraintFor(group: AnchorGroup, key: string, reg: Registry): any {
  const vf = reg.valueFormat || {};
  const g = (vf as any)[group] || {};
  return (g as any)[key];
}

function validateValue(group: AnchorGroup, key: string, val: any, reg: Registry): { ok: boolean; reason?: string } {
  const c = constraintFor(group, key, reg);
  if (!c) return { ok: true };

  const denyEmpty = (x: any) =>
    x === "" || x === null || x === undefined ||
    (Array.isArray(x) && x.length === 0) ||
    (typeof x === "object" && !Array.isArray(x) && Object.keys(x || {}).length === 0);

  if (denyEmpty(val)) return { ok: false, reason: "empty" };

  if (group === "text" || group === "block" || group === "hook" || group === "resources") {
    const s = String(val ?? "");
    if (c.minLen && s.length < c.minLen) return { ok: false, reason: `too_short(<${c.minLen})` };
    if (c.maxLen && s.length > c.maxLen) return { ok: false, reason: `too_long(>${c.maxLen})` };
    if (c.enum && Array.isArray(c.enum) && !c.enum.includes(s)) return { ok: false, reason: "enum" };
    if (c.regex && !(new RegExp(c.regex).test(s))) return { ok: false, reason: "regex" };
    if (/^__.*__$/.test(s) || /\{\{.*\}\}/.test(s) || /(placeholder|todo|sample|example|模板|样例)/i.test(s)) return { ok: false, reason: "deny-pattern" };
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

  if (group === "if") {
    return { ok: typeof val === "boolean" };
  }

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

function fillSkeletonFromRegistry(
  reg: Registry,
  seed: { appName: string; homeTitle: string; mainButtonText: string; packageId: string; locales: string[]; permissions: string[] }
) {
  const defText = reg.defaults?.text || {};
  const defList = reg.defaults?.list || {};

  const text: Record<string, string> = {};
  for (const k of reg.text) {
    if (k === "NDJC:APP_LABEL") text[k] = seed.appName || defText[k] || (reg.placeholders?.text?.[k] ?? "App");
    else if (k === "NDJC:HOME_TITLE") text[k] = seed.homeTitle || defText[k] || (reg.placeholders?.text?.[k] ?? "Home");
    else if (k === "NDJC:PRIMARY_BUTTON_TEXT") text[k] = seed.mainButtonText || defText[k] || (reg.placeholders?.text?.[k] ?? "Create");
    else if (k === "NDJC:PACKAGE_NAME") text[k] = seed.packageId || defText[k] || (reg.placeholders?.text?.[k] ?? "com.ndjc.demo.core");
    else text[k] = defText[k] ?? (reg.placeholders?.text?.[k] ?? "1");
  }
  const block: Record<string, string> = Object.fromEntries(
    reg.block.map((k) => [k, reg.placeholders?.block?.[k] ?? "@Composable fun Placeholder() { Text(\"OK\") }"])
  );
  const list: Record<string, string[]> = Object.fromEntries(
    reg.list.map((k) => [k, defList[k] ?? (reg.placeholders?.list?.[k] ?? (k === "ROUTES" ? ["home"] : ["ok"]))])
  );
  const iff: Record<string, boolean> = Object.fromEntries(reg.if.map((k) => [k, reg.placeholders?.if?.[k] ?? false]));
  const hook: Record<string, string> = Object.fromEntries(reg.hook.map((k) => [k, reg.placeholders?.hook?.[k] ?? "echo ok"]));
  const gradle = {
    applicationId: seed.packageId,
    resConfigs: seed.locales,
    permissions: seed.permissions,
  };
  return { text, block, list, if: iff, hook, gradle };
}

function enforceRequiredAndFormats(doc: any, reg: Registry) {
  const req = reg.required || {};
  const def = reg.defaults || {};
  const report = { missing: [] as string[], invalid: [] as string[] };

  doc.text ||= {}; doc.block ||= {}; doc.list ||= {}; doc.if ||= {}; doc.hook ||= {}; doc.gradle ||= {};

  for (const k of (req.text || [])) {
    let v = doc.text[k];
    if (v == null || v === "") v = def.text?.[k] ?? "1";
    doc.text[k] = v;
  }
  for (const k of (req.list || [])) {
    let v = doc.list[k];
    if (!Array.isArray(v) || v.length === 0) v = def.list?.[k] ?? ["ok"];
    doc.list[k] = v;
  }
  for (const k of (req.gradle || [])) {
    if (k === "applicationId") {
      let appId = doc.gradle.applicationId || doc.text?.["NDJC:PACKAGE_NAME"] || def.text?.["NDJC:PACKAGE_NAME"] || def.gradle?.applicationId || "com.ndjc.demo.core";
      appId = ensurePackageId(appId, "com.ndjc.demo.core");
      doc.gradle.applicationId = appId;
      if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId;
    } else if (k === "resConfigs") {
      if (!Array.isArray(doc.gradle.resConfigs)) doc.gradle.resConfigs = def.gradle?.resConfigs ?? ["en"];
    } else if (k === "permissions") {
      if (!Array.isArray(doc.gradle.permissions)) doc.gradle.permissions = def.gradle?.permissions ?? [];
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
        if (g === "list") doc[g][key] = key === "ROUTES" ? ["home"] : ["ok"];
        else if (g === "if") doc[g][key] = false;
        else doc[g][key] = g === "block" ? "@Composable fun F(){ Text(\"OK\") }" : "ok";
      }
    }
  });

  if (doc.gradle) {
    for (const key of ["applicationId","resConfigs","permissions"] as const) {
      if (doc.gradle[key] == null) continue;
      const ok = validateValue("gradle", key, doc.gradle[key], reg);
      if (!ok.ok) {
        report.invalid.push(`gradle:${key}`);
        if (key === "applicationId") doc.gradle.applicationId = ensurePackageId("com.ndjc.demo.core", "com.ndjc.demo.core");
        else if (key === "resConfigs") doc.gradle.resConfigs = ["en"];
        else if (key === "permissions") doc.gradle.permissions = ["android.permission.INTERNET"];
      }
    }
  }

  return { doc, report };
}

/** ---------------- main orchestrate ---------------- */
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
      required: { text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"], list: ["ROUTES"], gradle: ["applicationId"] },
      defaults: { text: { "NDJC:PACKAGE_NAME": "com.ndjc.demo.core", "NDJC:APP_LABEL": "NDJC App", "NDJC:HOME_TITLE": "Home", "NDJC:PRIMARY_BUTTON_TEXT": "Start" }, list: { "ROUTES": ["home"] }, gradle: { resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] } },
      placeholders: { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} },
      valueFormat: { text: {}, block: {}, list: {}, if: {}, hook: {}, resources: {}, gradle: {} },
    };

  const sysPrompt = await loadSystemPrompt();
  const rtyPrompt = await loadRetryPrompt();

  let appName = input.appName || reg.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App";
  let homeTitle = input.homeTitle || reg.defaults?.text?.["NDJC:HOME_TITLE"] || "Home";
  let mainButtonText = input.mainButtonText || reg.defaults?.text?.["NDJC:PRIMARY_BUTTON_TEXT"] || "Create";
  let packageId = ensurePackageId(input.packageId || input.packageName || reg.defaults?.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core");

  let permissions = input.permissions || reg.defaults?.gradle?.permissions || ["android.permission.INTERNET"];
  let intentHost = input.intentHost ?? null;
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
      model: process.env.NDJC_MODEL || "groq"
    }
  };

  const skeletonAnchors = fillSkeletonFromRegistry(reg, {
    appName, homeTitle, mainButtonText, packageId, locales, permissions
  });

  const skeleton = {
    metadata: { template, appName, packageId, mode },
    anchors: skeletonAnchors,
    files: [] as any[]
  };

  const baseUser = [
    "Return STRICT JSON only. Use the SAME keys of SKELETON. Do not add or remove any keys.",
    "Fill ALL anchors with BUILD-USABLE values. No placeholders/empties.",
    "SKELETON:",
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `User requirement: ${input.requirement!.trim()}` : ``)
  ].filter(Boolean).join("\n");

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
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [
        { role: "system", content: sysPrompt.text || "Return JSON only." },
        { role: "user", content: baseUser }
      ];

      if (attempt > 0) {
        if (lastText) msgs.push({ role: "assistant", content: lastText });
        const feedback = _trace.retries?.[attempt - 1]?.feedback || "";
        const retryText = (rtyPrompt.text || "").trim();
        msgs.push({ role: "user", content: [retryText, feedback].filter(Boolean).join("\n\n") });
      }

      const r = await callGroqChat(msgs, { temperature: 0, max_tokens: 2048, top_p: 1 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = maybe?.anchors || maybe?.anchorsGrouped || {};
      const { doc, report } = enforceRequiredAndFormats(
        { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} },
        reg
      );

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: (report.invalid.length === 0) };
      _trace.retries.push({
        attempt,
        ok: parsed._ok,
        report,
        feedback: (!parsed._ok)
          ? [
              "Normalize to allowed anchors only and satisfy all required keys.",
              ...(report.invalid.length ? [`Invalid:`, ...report.invalid.map((s:string)=>`- ${s}`)] : [])
            ].join("\n")
          : undefined
      });

      if (parsed._ok) break;
    } catch (e: any) {
      _trace.retries.push({ attempt, error: e?.message || String(e) });
    }
  }

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
