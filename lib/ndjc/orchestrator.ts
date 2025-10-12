import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/* ======================== types ======================== */

type Registry = {
  template: string;
  schemaVersion?: string;

  text: string[];
  block: string[];
  list: string[];
  if: string[];
  hook: string[];
  resources?: string[];

  /** 允许的别名 -> 规范键（会被规范化） */
  aliases?: Record<string, string>;

  /** 必填项：缺失会判定为不合规 */
  required?: {
    text?: string[];
    block?: string[];
    list?: string[];
    if?: string[];
    hook?: string[];
    gradle?: string[];
  };

  /** 默认值：当缺失时用于兜底 */
  defaults?: {
    text?: Record<string, string>;
    list?: Record<string, string[]>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };

  /** 值格式约束（可选）：用于提示/检验/回填 */
  valueRules?: {
    text?: Record<string, { type: "string"; placeholder?: string }>;
    block?: Record<string, { type: "string"; placeholder?: string }>;
    list?: Record<string, { type: "string[]"; placeholder?: string[] }>;
    if?: Record<string, { type: "boolean"; placeholder?: boolean }>;
    hook?: Record<string, { type: "string"; placeholder?: string }>;
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

/* ======================== helpers ======================== */

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
    const reg = JSON.parse(buf) as Registry;
    console.log("[orchestrator] registry loaded:", { file: hint, template: reg.template, schemaVersion: reg.schemaVersion });
    return reg;
  } catch (e: any) {
    console.log("[orchestrator] registry load failed, fallback minimal:", e?.message || String(e));
    return null;
  }
}

function withPrefix(kind: "BLOCK" | "LIST" | "IF" | "HOOK", xs: string[]): string[] {
  return (xs || []).map((k) => `${kind}:${k}`);
}

/** 从提示词文件读取 system / retry 内容（来源打点） */
async function loadPrompts() {
  const cwd = process.cwd();
  const systemFile =
    process.env.NDJC_PROMPT_SYSTEM_FILE ||
    path.join(cwd, "lib/ndjc/prompts/contract_v1.en.json");
  const retryFile =
    process.env.NDJC_PROMPT_RETRY_FILE ||
    path.join(cwd, "lib/ndjc/prompts/contract_v1.retry.en.txt");

  let systemText = "";
  let retryText = "";

  try {
    const raw = await fs.readFile(systemFile, "utf8");
    // 允许纯文本或 { system: "..."} 两种
    try {
      const obj = JSON.parse(raw);
      systemText = String(obj.system || obj.prompt || raw || "");
    } catch {
      systemText = raw;
    }
  } catch (e: any) {
    console.log("[orchestrator] system prompt read failed:", { file: systemFile, error: e?.message || String(e) });
  }

  try {
    retryText = await fs.readFile(retryFile, "utf8");
  } catch (e: any) {
    console.log("[orchestrator] retry prompt read failed:", { file: retryFile, error: e?.message || String(e) });
  }

  console.log("[orchestrator] prompt sources:", {
    systemFile,
    systemRead: systemText ? true : false,
    retryFile,
    retryRead: retryText ? true : false,
  });

  return { systemText, retryText, systemFile, retryFile };
}

/** 把注册表变成“可回填的骨架表单”：所有规范键都出现，值给空/默认 */
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

  const skeleton = {
    metadata: { template: reg.template, appName: seed.appName, packageId: seed.packageId, mode: "B" },
    anchors: { text, block, list, if: iff, hook, gradle },
    files: [] as any[]
  };

  return skeleton;
}

/* ---------- alias & prefix normalization ---------- */

function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;
  const direct = aliases?.[k];
  if (direct) return direct;
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k)) return k;

  // 宽松推断（极少用；主要靠 registry+表单锁死）
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
    const m = (from as any)[g] || {};
    for (const [k, v] of Object.entries<any>(m)) {
      let key1 = /^(TEXT|BLOCK|LIST|IF|HOOK):/.test(k) ? k : normalizeKeyWithAliases(k, reg.aliases);
      const mapped = reg.aliases?.[key1] || reg.aliases?.[k];
      const key2 = mapped || key1;
      tryAssign(out, key2, v);
    }
  }
  if ((from as any).gradle && typeof (from as any).gradle === "object") out.gradle = { ...(from as any).gradle };

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

/* ======================== main orchestrate ======================== */

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
      required: {
        text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
        list: ["ROUTES"],
        gradle: ["applicationId"]
      },
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

  // 初值
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

  const _trace: any = {
    retries: [],
    sources: {},
  };

  // 读取提示词（来源打点）
  const { systemText, retryText, systemFile, retryFile } = await loadPrompts();
  _trace.sources.systemPrompt = { file: systemFile, loaded: !!systemText };
  _trace.sources.retryPrompt = { file: retryFile, loaded: !!retryText };

  // 生成 skeleton（把可填的键全部列出）
  const skeleton = buildSkeletonFromRegistry(reg, { appName, packageId, locales });

  // 组装 user 指令（只负责把数据/规则拼进去；真正的“风格/强约束”在 systemText 内）
  const baseUser = [
    `Please strictly fill the following SKELETON and return the **same JSON shape** (no extra/missing keys).`,
    `If any field is not applicable, use the placeholder value described by the registry (or empty string/[]/false as type demands).`,
    `Only output raw JSON (no markdown fences).`,
    `SKELETON:`,
    JSON.stringify(skeleton, null, 2),
    input.requirement?.trim() ? `Requirement: ${input.requirement!.trim()}` : ``,
  ]
    .filter(Boolean)
    .join("\n");

  // -------- 调 LLM：生成 + 校验→必要时重试 --------
  const maxRetries = 2;
  let parsed: any = null;
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const msgs: any[] = [];
      if (systemText) msgs.push({ role: "system", content: systemText });
      msgs.push({ role: "user", content: baseUser });

      if (attempt > 0) {
        if (_trace.retries?.[attempt - 1]?.feedback) {
          msgs.push({ role: "user", content: _trace.retries[attempt - 1].feedback });
        }
        if (lastText) {
          msgs.push({ role: "assistant", content: lastText });
          msgs.push({
            role: "user",
            content:
              (retryText || "Previous output is invalid. Please fix the issues and resend full JSON.") +
              "\nReturn full JSON with the SAME KEYS.",
          });
        }
      }

      console.log("[orchestrator] callGroqChat.start", { attempt, withSystem: !!systemText, withRetry: attempt > 0 });
      const r = await callGroqChat(msgs, { json: true, temperature: 0 });
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      lastText = text;
      console.log("[orchestrator] callGroqChat.done", { attempt, textLen: text.length });

      const maybe = parseJsonSafely(text) as any;
      const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg);
      const { ok, report, doc } = applyDefaultsAndCheckRequired(
        { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} },
        reg
      );

      parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: ok };

      const fb = ok
        ? undefined
        : [
            "You missed required fields. Fill them and use only **canonical** keys from the registry:",
            ...report.missing.map((m: string) => `- missing: ${m}`),
            "Use defaults/placeholders if necessary. Return the full JSON again with the same keys.",
          ].join("\n");

      _trace.retries.push({ attempt, ok, report, feedback: fb });

      console.log("[orchestrator] validate.result", { attempt, ok, missing: report.missing });

      if (ok) break;
    } catch (e: any) {
      console.log("[orchestrator] callGroqChat.error", { attempt, error: e?.message || String(e) });
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
    console.log("[orchestrator] synthesized v1 due to empty LLM output");
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

  // 关键来源打点：供前端/日志快速确认
  _trace.summary = {
    template,
    mode,
    fromPromptFile: !!systemText,
    promptFilePath: systemFile,
    retryFilePath: retryFile,
    generatedTextLen: (_trace.rawText || "").length,
  };

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
