import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** ---------------- Registry / Rules ---------------- */

type ValueRule =
  | { type: "string"; placeholder?: string; examples?: string[] }
  | { type: "boolean"; default?: boolean }
  | { type: "string[]"; examples?: string[] }
  | { type: "json"; schemaHint?: string; placeholder?: string };

type Registry = {
  template: string;
  schemaVersion?: string;

  // 锚点清单（显式在循环时断言为 string[] 使用）
  text: readonly string[];
  block: readonly string[];
  list: readonly string[];
  if: readonly string[];
  hook: readonly string[];
  resources?: readonly string[];

  // 别名
  aliases?: Record<string, string>;

  // 必填项
  required?: {
    text?: readonly string[];
    block?: readonly string[];
    list?: readonly string[];
    if?: readonly string[];
    hook?: readonly string[];
    gradle?: readonly string[];
  };

  // 默认值
  defaults?: {
    text?: Record<string, string>;
    list?: Record<string, string[]>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };

  // 值约束（可选）
  valueRules?: {
    text?: Record<string, ValueRule>;
    block?: Record<string, ValueRule>;
    list?: Record<string, ValueRule>;
    if?: Record<string, ValueRule>;
    hook?: Record<string, ValueRule>;
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

function withPrefix(kind: "BLOCK" | "LIST" | "IF" | "HOOK", xs: readonly string[]): string[] {
  return (xs as string[]).map((k) => `${kind}:${k}`);
}

/** 获取某键的约束 */
function getRule(
  group:
    | "text"
    | "block"
    | "list"
    | "if"
    | "hook",
  key: string,
  reg?: Registry
): ValueRule | undefined {
  const r = reg?.valueRules?.[group as keyof NonNullable<Registry["valueRules"]>] as
    | Record<string, ValueRule>
    | undefined;
  return r?.[key];
}

/** 构建“回填骨架表单” */
function buildSkeletonFromRegistry(
  reg: Registry,
  seed: { appName: string; packageId: string; locales: string[] }
) {
  const defText = reg.defaults?.text || {};
  const defList = reg.defaults?.list || {};
  const defGradle = reg.defaults?.gradle || {};

  const text: Record<string, string> = {};
  for (const k of reg.text as string[]) {
    const key = String(k);
    if (key === "NDJC:APP_LABEL") text[key] = seed.appName || defText[key] || "";
    else if (key === "NDJC:PACKAGE_NAME") text[key] = seed.packageId || defText[key] || "";
    else text[key] = defText[key] ?? "";
  }

  const block: Record<string, string> = {};
  for (const k of reg.block as string[]) block[String(k)] = "";

  const list: Record<string, string[]> = {};
  for (const k of reg.list as string[]) list[String(k)] = defList[String(k)] ?? [];

  const iff: Record<string, boolean> = {};
  for (const k of reg.if as string[]) iff[String(k)] = false;

  const hook: Record<string, string> = {};
  for (const k of reg.hook as string[]) hook[String(k)] = "";

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
  const allowText = reg.text as string[];
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList = withPrefix("LIST", reg.list);
  const allowIf = withPrefix("IF", reg.if);
  const allowHook = withPrefix("HOOK", reg.hook);

  const required = {
    text: (reg.required?.text as string[]) || [],
    list: (reg.required?.list as string[]) || [],
    block: (reg.required?.block as string[]) || [],
    if: (reg.required?.if as string[]) || [],
    hook: (reg.required?.hook as string[]) || [],
    gradle: (reg.required?.gradle as string[]) || []
  };
  const defaults = reg.defaults || {};

  const lines: string[] = [];
  lines.push(`You are NDJC's template assistant. **Return strict JSON only** (no markdown).`);
  lines.push(`Template: ${reg.template}`);
  lines.push(`Allowed canonical keys only:`);
  lines.push(`- Text: ${allowText.join(", ")}`);
  lines.push(`- Block: ${allowBlock.join(", ")}`);
  lines.push(`- List: ${allowList.join(", ")}`);
  lines.push(`- If: ${allowIf.join(", ")}`);
  lines.push(`- Hook: ${allowHook.join(", ")}`);
  if (reg.resources?.length) lines.push(`- Resources: ${(reg.resources as string[]).join(", ")}`);
  lines.push(`**Do not add or remove keys; do not use aliases.**`);
  lines.push(`Required:`);
  lines.push(`- text.required: ${required.text.join(", ") || "(none)"}`);
  lines.push(`- list.required: ${required.list.join(", ") || "(none)"}`);
  lines.push(`- gradle.required: ${required.gradle.join(", ") || "(none)"}`);
  if (required.block.length) lines.push(`- block.required: ${required.block.join(", ")}`);
  if (required.if.length) lines.push(`- if.required: ${required.if.join(", ")}`);
  if (required.hook.length) lines.push(`- hook.required: ${required.hook.join(", ")}`);
  lines.push(`Defaults:`);
  lines.push(`- text.defaults: ${JSON.stringify(defaults.text || {})}`);
  lines.push(`- list.defaults: ${JSON.stringify(defaults.list || {})}`);
  lines.push(`- gradle.defaults: ${JSON.stringify(defaults.gradle || {})}`);
  lines.push(`Output must be **Contract v1** JSON and keep the same keys as the SKELETON.`);
  return lines.join("\n");
}

/** ---------- alias & prefix normalization ---------- */

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // 宽松推断（尽量少触发；主靠 registry 锁死）
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

  const groups = ["text", "block", "list", "if", "hook"] as const;
  const from = raw || {};
  for (const g of groups) {
    const m = from[g] || {};
    for (const [k, v] of Object.entries(m)) {
      const mapped = reg.aliases?.[k] || reg.aliases?.[String(k)];
      const key1 = mapped || (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k) ? k : normalizeKeyWithAliases(String(k), reg.aliases));
      tryAssign(out, key1, v);
    }
  }
  if (from.gradle && typeof from.gradle === "object") out.gradle = { ...from.gradle };

  // 白名单裁剪（canonical）
  const keep = {
    text: new Set(reg.text as string[]),
    block: new Set(reg.block as string[]),
    list: new Set(reg.list as string[]),
    if: new Set(reg.if as string[]),
    hook: new Set(reg.hook as string[])
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

/** ---------- required/defaults checking ---------- */

function applyDefaultsAndCheckRequired(doc: any, reg: Registry) {
  const req = reg.required || {};
  const def = reg.defaults || {};
  const report = { filled: { text: [] as string[], list: [] as string[], gradle: [] as string[] }, missing: [] as string[] };

  // TEXT required
  for (const k of ((req.text as string[]) || [])) {
    const key = String(k);
    if (!doc.text?.[key]) {
      const dv = def.text?.[key] ?? "";
      if (dv !== "") {
        doc.text[key] = dv;
        report.filled.text.push(key);
      } else {
        report.missing.push(`text:${key}`);
      }
    }
  }

  // LIST required
  for (const k of ((req.list as string[]) || [])) {
    const key = String(k);
    const cur = doc.list?.[key];
    if (!Array.isArray(cur) || cur.length === 0) {
      const dv = def.list?.[key] ?? [];
      if (dv.length) {
        doc.list[key] = dv;
        report.filled.list.push(key);
      } else {
        report.missing.push(`list:${key}`);
      }
    }
  }

  // GRADLE required
  if (!doc.gradle) doc.gradle = {};
  for (const k of ((req.gradle as string[]) || [])) {
    const key = String(k);
    if (key === "applicationId") {
      let appId =
        doc.gradle.applicationId ||
        doc.text?.["NDJC:PACKAGE_NAME"] ||
        def.text?.["NDJC:PACKAGE_NAME"] ||
        def.gradle?.applicationId;
      appId = ensurePackageId(appId, "com.ndjc.demo.core");
      if (!appId) report.missing.push("gradle:applicationId");
      else {
        doc.gradle.applicationId = appId;
        if (!doc.text["NDJC:PACKAGE_NAME"]) doc.text["NDJC:PACKAGE_NAME"] = appId;
        report.filled.gradle.push("applicationId");
      }
    } else {
      if (doc.gradle[key] == null && (def.gradle as any)?.[key] != null) {
        (doc.gradle as any)[key] = (def.gradle as any)[key];
        report.filled.gradle.push(key);
      }
    }
  }

  // 兜底默认
  if (!Array.isArray(doc.gradle.resConfigs) && Array.isArray(reg.defaults?.gradle?.resConfigs)) {
    doc.gradle.resConfigs = reg.defaults!.gradle!.resConfigs;
  }
  if (!Array.isArray(doc.gradle.permissions) && Array.isArray(reg.defaults?.gradle?.permissions)) {
    doc.gradle.permissions = reg.defaults!.gradle!.permissions;
  }

  const ok = report.missing.length === 0;
  return { ok, report, doc };
}

/** ---------------- main orchestrate ---------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg =
    (await loadRegistry()) || {
      template: "circle-basic",
      text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"] as const,
      block: [] as const,
      list: ["ROUTES"] as const,
      if: [] as const,
      hook: [] as const,
      aliases: {},
      required: { text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"], list: ["ROUTES"], gradle: ["applicationId"] },
      defaults: {
        text: {
          "NDJC:PACKAGE_NAME": "com.ndjc.demo.core",
          "NDJC:APP_LABEL": "NDJC App",
          "NDJC:HOME_TITLE": "Home",
          "NDJC:PRIMARY_BUTTON_TEXT": "Start"
        },
        list: { "ROUTES": ["home"] },
        gradle: { resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] }
      }
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

  // 用户消息
  const baseUser = [
    `请**严格**按下述 SKELETON 的键集合回填所有值（不要新增/删除键）。`,
    `- 若缺数据：使用系统提示中给定的默认值；`,
    `- 类型要求：text=string，block/hook=string（可放 XML/代码片段），list=string[]，if=boolean；`,
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
