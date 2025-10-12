// lib/ndjc/orchestrator.ts
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** ---------------- types ---------------- */
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
    // 允许 .json 或 .txt；如果是 json 里含字段 { "system": "..." }
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

/** ----- canonicalization / defaults / required ----- */

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

  // 白名单裁剪
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

function applyDefaultsAndCheckRequired(doc: any, reg: Registry) {
  const req = reg.required || {};
  const def = reg.defaults || {};
  const report = { filled: { text: [] as string[], list: [] as string[], gradle: [] as string[] }, missing: [] as string[] };

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
      let appId = doc.gradle.applicationId || doc.text?.["NDJC:PACKAGE_NAME"] || def.text?.["NDJC:PACKAGE_NAME"] || def.gradle?.applicationId;
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

  // 兜底：resConfigs/permissions 默认
  if (!Array.isArray(doc.gradle.resConfigs) && Array.isArray(def.gradle?.resConfigs)) {
    doc.gradle.resConfigs = def.gradle!.resConfigs;
  }
  if (!Array.isArray(doc.gradle.permissions) && Array.isArray(def.gradle?.permissions)) {
    doc.gradle.permissions = def.gradle!.permissions;
  }

  const ok = report.missing.length === 0;
  return { ok, report, doc };
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
        // 把上一轮不合格的全文贴回去，并附上 retry 指令
        if (lastText) {
          msgs.push({ role: "assistant", content: lastText });
        }
        const feedback = _trace.retries?.[attempt - 1]?.feedback || "";
        const retryText =
          (rtyPrompt.text || "").trim() ||
          "Fix mistakes. Keep the same keys as SKELETON. Fill required anchors. Return JSON only.";
        msgs.push({
          role: "user",
          content: [retryText, feedback].filter(Boolean).join("\n\n"),
        });
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

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: ok };
      _trace.retries.push({
        attempt,
        ok,
        report,
        feedback: ok
          ? undefined
          : [
              "Missing required anchors. Please refill using only allowed canonical keys.",
              ...report.missing.map((m: string) => `- missing: ${m}`),
            ].join("\n"),
      });

      if (ok) break;
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
