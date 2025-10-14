// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** ------------ types ------------ */
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
  required?: Partial<Record<AnchorGroup | "gradle", string[]>>;
  defaults?: {
    text?: Record<string, string>;
    list?: Record<string, string[]>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };
  placeholders?: Partial<Record<AnchorGroup | "gradle", any>>;
  valueFormat?: {
    text?: Record<string, { regex?: string }>;
    block?: Record<string, { minLen?: number; mustContainAny?: string[]; denyPatterns?: string[] } | { [k: string]: any }>;
    list?: Record<string, { minItems?: number; itemMinLen?: number; itemRegex?: string; denyPatterns?: string[] }>;
    if?: Record<string, any>;
    hook?: Record<string, { minLen?: number; denyPatterns?: string[] }>;
    resources?: Record<string, any>;
    gradle?: {
      applicationId?: { regex?: string };
      resConfigs?: { itemRegex?: string };
      permissions?: { allowList?: string[] };
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

/** ------------ helpers ------------ */
const ROOT = process.cwd();

function ensureMode(v?: string): "A" | "B" {
  return v === "A" || v === "B" ? v : "B";
}
function ensurePackageId(input?: string, fallback = "com.ndjc.demo.core") {
  let v = (input || "").trim();
  if (!v) return fallback;
  v = v.replace(/[^a-zA-Z0-9_.]+/g, "").replace(/^\.+|\.+$/g, "").replace(/\.+/g, ".");
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
function parseJson(text: string): any | null {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/) || null;
  const raw = m ? m[1] : text;
  try { return JSON.parse(raw); } catch { return null; }
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
    out.push({ path: rel, content: typeof it.content === "string" ? it.content : "", overwrite: !!it.overwrite, kind: it.kind || "txt" });
  }
  return out;
}
async function readTextAndHash(filePath: string) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
  const raw = await fs.readFile(abs, "utf8");
  const sha = crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  return { abs, raw, sha, size: Buffer.byteLength(raw) };
}
async function loadRegistry(): Promise<Registry> {
  const hint = process.env.NDJC_REGISTRY_FILE || path.join(ROOT, "lib/ndjc/anchors/registry.circle-basic.json");
  const buf = await fs.readFile(hint, "utf8");
  const json = JSON.parse(buf) as Registry;
  json.valueFormat ??= {};
  json.placeholders ??= {};
  return json;
}
async function loadPromptFiles() {
  const sysPath = process.env.NDJC_PROMPT_SYSTEM_FILE || path.join(ROOT, "lib/ndjc/prompts/contract_v1.en.json");
  const rtyPath = process.env.NDJC_PROMPT_RETRY_FILE || path.join(ROOT, "lib/ndjc/prompts/contract_v1.retry.en.txt");
  const sys = await readTextAndHash(sysPath);
  const rty = await readTextAndHash(rtyPath);
  let system = sys.raw;
  try { const maybe = JSON.parse(system); if (maybe && typeof maybe.system === "string") system = maybe.system; } catch {}
  return {
    system: { path: sys.abs, text: system, sha: sys.sha, size: sys.size },
    retry: { path: rty.abs, text: rty.raw, sha: rty.sha, size: rty.size }
  };
}

/** -------- registry helpers -------- */
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
function validateAgainstVF(group: AnchorGroup, key: string, val: any, reg: Registry): { ok: boolean; reason?: string } {
  const vf = reg.valueFormat || {};
  const deny = (vf as any)[group]?.["*"]?.denyPatterns as string[] | undefined;
  const denyOk = (s: string) => !(deny || []).some((p) => new RegExp(p).test(s));

  if (group === "text") {
    if (key === "NDJC:PACKAGE_NAME") {
      const re = new RegExp(vf.text?.["NDJC:PACKAGE_NAME"]?.regex || "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$");
      return { ok: re.test(String(val || "")) && denyOk(String(val || "")) };
    }
    return { ok: String(val ?? "").length > 0 && denyOk(String(val)) };
  }

  if (group === "block") {
    const rules = (vf.block?.["*"] as any) || {};
    const s = String(val ?? "");
    const min = rules.minLen || 0;
    const containsOk = (rules.mustContainAny || []).some((t: string) => new RegExp(t).test(s));
    return { ok: s.length >= min && containsOk && denyOk(s) };
  }

  if (group === "list") {
    const common = (vf.list?.["*"] as any) || {};
    const arr = Array.isArray(val) ? val : [];
    if ((common.minItems ?? 0) > arr.length) return { ok: false, reason: "minItems" };
    if (common.itemMinLen) for (const it of arr) if (String(it).length < common.itemMinLen) return { ok: false, reason: "itemMinLen" };
    const specific = vf.list?.[key];
    if (specific?.itemRegex) {
      const re = new RegExp(specific.itemRegex);
      for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
    }
    for (const it of arr) if (!(denyOk(String(it)))) return { ok: false, reason: "deny" };
    return { ok: true };
  }

  if (group === "hook") {
    const rules = (vf.hook?.["*"] as any) || {};
    const s = String(val ?? "");
    return { ok: s.length >= (rules.minLen || 0) && denyOk(s) };
  }

  if (group === "gradle") {
    if (key === "applicationId") {
      const re = new RegExp(vf.gradle?.applicationId?.regex || "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$");
      return { ok: re.test(String(val || "")) };
    }
    if (key === "resConfigs") {
      const re = new RegExp(vf.gradle?.resConfigs?.itemRegex || "^[a-z]{2}(-r[A-Z]{2})?$");
      const arr = Array.isArray(val) ? val : [];
      for (const it of arr) if (!re.test(String(it))) return { ok: false, reason: "itemRegex" };
      return { ok: true };
    }
    if (key === "permissions") {
      const allow = new Set(vf.gradle?.permissions?.allowList || []);
      const arr = Array.isArray(val) ? val : [];
      for (const it of arr) if (allow.size && !allow.has(String(it))) return { ok: false, reason: "allowList" };
      return { ok: true };
    }
  }
  return { ok: true };
}
function applyWhitelist(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };
  const groups: AnchorGroup[] = ["text", "block", "list", "if", "hook"];
  for (const g of groups) {
    const allow = pickWhitelist(g, reg);
    const src = raw?.[g] || {};
    for (const [k, v] of Object.entries(src)) {
      const key = k.replace(/^(TEXT|BLOCK|LIST|IF|HOOK):/, "");
      if (allow.has(key)) (out as any)[g][key] = v;
    }
  }
  if (raw?.gradle) out.gradle = { ...raw.gradle };
  return out;
}

/** ------------ main ------------ */
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg = await loadRegistry();
  const { system, retry } = await loadPromptFiles();

  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "NDJC Home";
  let mainButtonText = input.mainButtonText || "Create";
  let packageId = ensurePackageId(input.packageId || input.packageName || reg.defaults?.gradle?.applicationId);
  let permissions = input.permissions || [];
  let locales = normalizeLocales(input.locales);
  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];
  const mode = ensureMode(input.mode);
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = reg.template || "circle-basic";

  const _trace: any = {
    source: { registry: "registry.circle-basic.json", prompt: system.path, retry: retry.path },
    retries: []
  };

  const skeleton = {
    metadata: { template, appName, packageId, mode },
    anchorsGrouped: {
      text: {
        "NDJC:PACKAGE_NAME": packageId,
        "NDJC:APP_LABEL": appName,
        "NDJC:HOME_TITLE": homeTitle,
        "NDJC:PRIMARY_BUTTON_TEXT": mainButtonText
      },
      block: { "HOME_BODY": "@Composable fun Home(){ LazyColumn{} }" },
      list: { "ROUTES": ["home"] },
      if: {},
      hook: {},
      gradle: {
        applicationId: packageId,
        resConfigs: locales,
        permissions: permissions.length ? permissions : (reg.defaults?.gradle?.permissions || [])
      }
    },
    files: []
  };

  const baseUser = [
    "Return STRICT JSON only.",
    "Use EXACTLY the same keys of SKELETON.",
    JSON.stringify(skeleton, null, 2),
    input.requirement ? `User requirement: ${input.requirement}` : ""
  ].filter(Boolean).join("\n");

  let lastText = "";
  let parsed: any = null;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const msgs: any[] = [
      { role: "system", content: system.text },
      { role: "user", content: baseUser }
    ];
    if (attempt > 0) {
      msgs.push({ role: "assistant", content: lastText });
      const issues = _trace.retries?.[attempt - 1]?.issues || "fix schema violations";
      msgs.push({ role: "user", content: retry.text.replace("{ISSUES}", issues) });
    }

    const r = await callGroqChat(msgs, { json: true, temperature: 0 });
    lastText = typeof r === "string" ? r : (r as any)?.text ?? "";
    parsed = parseJson(lastText);

    if (!parsed) {
      _trace.retries.push({ attempt, ok: false, issues: "E_NOT_JSON" });
      continue;
    }

    // 归一化并裁剪到白名单
    const normalized = applyWhitelist(parsed.anchorsGrouped || parsed.anchors || {}, reg);

    // 必填补齐
    (reg.required?.text || []).forEach((k) => {
      if (!normalized.text[k]) normalized.text[k] = reg.defaults?.text?.[k] || "";
    });
    (reg.required?.list || []).forEach((k) => {
      if (!Array.isArray(normalized.list[k]) || !normalized.list[k].length) normalized.list[k] = reg.defaults?.list?.[k] || [];
    });
    (reg.required?.block || []).forEach((k) => {
      if (!normalized.block[k]) normalized.block[k] = "@Composable fun Placeholder(){ Modifier }";
    });
    if (!normalized.gradle) normalized.gradle = {};
    const g = normalized.gradle;
    g.applicationId ||= ensurePackageId(reg.defaults?.gradle?.applicationId);
    g.resConfigs = Array.isArray(g.resConfigs) && g.resConfigs.length ? g.resConfigs : (reg.defaults?.gradle?.resConfigs || ["en"]);
    g.permissions = Array.isArray(g.permissions) ? g.permissions : (reg.defaults?.gradle?.permissions || []);

    // 校验
    const problems: string[] = [];
    const groups: AnchorGroup[] = ["text", "block", "list", "hook"];
    for (const gp of groups) {
      const allow = pickWhitelist(gp, reg);
      for (const key of Object.keys(normalized[gp] || {})) {
        if (!allow.has(key)) { delete normalized[gp][key]; continue; }
        const val = (normalized as any)[gp][key];
        const ok = validateAgainstVF(gp, key, val, reg);
        if (!ok.ok) problems.push(`${gp}:${key}:${ok.reason || "invalid"}`);
      }
    }
    for (const k of ["applicationId", "resConfigs", "permissions"] as const) {
      const ok = validateAgainstVF("gradle", k, g[k], reg);
      if (!ok.ok) problems.push(`gradle:${k}:${ok.reason || "invalid"}`);
    }

    _trace.retries.push({ attempt, ok: problems.length === 0, issues: problems.join("; "), raw: lastText });
    if (problems.length === 0) {
      parsed.anchorsGrouped = normalized;
      break;
    }
  }

  // 元数据/关键值抽取
  const anchors = parsed?.anchorsGrouped || skeleton.anchorsGrouped;
  if (anchors?.text) {
    appName = anchors.text["NDJC:APP_LABEL"] || appName;
    homeTitle = anchors.text["NDJC:HOME_TITLE"] || homeTitle;
    mainButtonText = anchors.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;
    packageId = ensurePackageId(anchors.text["NDJC:PACKAGE_NAME"] || packageId);
  }
  if (anchors?.gradle) {
    locales = Array.isArray(anchors.gradle.resConfigs) ? anchors.gradle.resConfigs : locales;
    permissions = Array.isArray(anchors.gradle.permissions) ? anchors.gradle.permissions : permissions;
  }

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(input.intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = input.resConfigs || localesToResConfigs(locales);

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
    proguardExtra: input.proguardExtra,
    packagingRules: input.packagingRules,
    permissionsXml,
    intentFiltersXml,
    themeOverridesXml,
    companions: allowCompanions ? companions : [],
    _trace
  };
}
