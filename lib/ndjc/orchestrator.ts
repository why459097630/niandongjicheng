import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

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

async function loadRegistry(): Promise<Registry | null> {
  const root = process.cwd();
  // 支持两种环境变量名：REGISTRY_FILE 优先，其次 NDJC_REGISTRY_FILE
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

/** 把注册表变成“可回填的骨架表单”：所有规范键都出现，值给空/默认 */
function buildSkeletonFromRegistry(reg: Registry, seed: {
  appName: string; packageId: string; locales: string[];
}) {
  const defText = reg.defaults?.text || {};
  const defList = reg.defaults?.list || {};
  const defGradle = reg.defaults?.gradle || {};

  const text: Record<string, string> = {};
  for (const k of reg.text) {
    // 关键四项用已有信息兜底；其余按默认或空串
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

function buildSystemPromptFromRegistry(reg: Registry): string {
  const allowText = reg.text;
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList = withPrefix("LIST", reg.list);
  const allowIf = withPrefix("IF", reg.if);
  const allowHook = withPrefix("HOOK", reg.hook);

  const required = {
    text: reg.required?.text || [],
    list: reg.required?.list || [],
    block: reg.required?.block || [],
    if: reg.required?.if || [],
    hook: reg.required?.hook || [],
    gradle: reg.required?.gradle || []
  };
  const defaults = reg.defaults || {};

  const lines: string[] = [];
  lines.push(`你是“念动即成 NDJC”的模板生成助手。**只输出严格 JSON**（不要 Markdown 代码块）。`);
  lines.push(`模板：${reg.template}`);
  lines.push(`只允许使用以下“规范锚点键名”（canonical keys）：`);
  lines.push(`- Text: ${allowText.join(", ")}`);
  lines.push(`- Block: ${allowBlock.join(", ")}`);
  lines.push(`- List: ${allowList.join(", ")}`);
  lines.push(`- If: ${allowIf.join(", ")}`);
  lines.push(`- Hook: ${allowHook.join(", ")}`);
  if (reg.resources?.length) lines.push(`- Resources: ${reg.resources.join(", ")}`);
  lines.push(`**禁止新增或删除任何键名；禁止使用别名或未列出的键名。**`);
  lines.push(`必填项（缺少不允许返回）：`);
  lines.push(`- text.required: ${required.text.join(", ") || "(none)"}`);
  lines.push(`- list.required: ${required.list.join(", ") || "(none)"}`);
  lines.push(`- gradle.required: ${required.gradle.join(", ") || "(none)"}`);
  if (required.block.length) lines.push(`- block.required: ${required.block.join(", ")}`);
  if (required.if.length) lines.push(`- if.required: ${required.if.join(", ")}`);
  if (required.hook.length) lines.push(`- hook.required: ${required.hook.join(", ")}`);
  lines.push(`默认值（缺信息请使用下列默认）：`);
  lines.push(`- text.defaults: ${JSON.stringify(defaults.text || {})}`);
  lines.push(`- list.defaults: ${JSON.stringify(defaults.list || {})}`);
  lines.push(`- gradle.defaults: ${JSON.stringify(defaults.gradle || {})}`);
  lines.push(`输出必须为 **Contract v1** JSON，且键集合与“回填骨架(SKELETON)”完全一致。`);
  return lines.join("\n");
}

/* ---------- alias & prefix normalization ---------- */

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // 宽松推断（极少用到；主要靠 registry+表单锁死）
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

/* ---------- required/defaults checking ---------- */

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

  const system = buildSystemPromptFromRegistry(reg);
  const skeleton = buildSkeletonFromRegistry(reg, { appName, packageId, locales });

  // “表单回填”指令：请严格把 SKELETON 中的值回填完毕并返回同结构 JSON
  const baseUser = [
    `请**严格**按下述 SKELETON 的键集合回填所有值（不要新增/删除键）。`,
    `- 若缺数据：使用系统提示中给定的默认值；`,
    `- 类型要求：text=string，block/hook=string（代码或 XML 片段），list=string[]，if=boolean，gradle 字段按示例；`,
    `- 只返回 JSON（不要解释文字）。`,
    `SKELETON:`,
    JSON.stringify(skeleton, null, 2),
    (input.requirement?.trim() ? `需求补充：${input.requirement!.trim()}` : ``)
  ].filter(Boolean).join("\n");

  // 生成 + 校验→重试
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
        // 把上一轮不合格全文也贴回去，让模型“改正后重发”
        msgs.push({ role: "assistant", content: lastText });
        msgs.push({ role: "user", content: "上面的内容不合规。请根据反馈修正并重新返回完整 JSON（同样的键集合）。" });
      }

      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      const maybe = parseJsonSafely(text) as any;

      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const { ok, report, doc } = applyDefaultsAndCheckRequired({ ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} }, reg);

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: ok };
      _trace.retries.push({
        attempt,
        ok,
        report,
        feedback: ok
          ? undefined
          : [
              "你没有满足以下必填项，请补齐并仅使用允许的规范键：",
              ...report.missing.map((m: string) => `- 缺失：${m}`),
              "若缺数据请使用默认值（上文已提供）。",
              "请重新返回完整 JSON。"
            ].join("\n")
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
