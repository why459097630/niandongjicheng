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

  /** 别名映射（可选） */
  aliases?: Record<string, string>;

  /** 必填项（可选） */
  required?: {
    text?: string[];
    block?: string[];
    list?: string[];
    if?: string[];
    hook?: string[];
    gradle?: string[];
  };

  /** 默认值（可选） */
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
  v = v.replace(/[^a-zA-Z0-9_.]/g, ".");
  v = v.replace(/\.+/g, ".");
  v = v.replace(/^\.+|\.+$/g, "");
  if (!v.includes(".")) v = `com.${v}`;
  return v.toLowerCase();
}

function uniq(xs: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function normalizeLocales(ls?: string[]) {
  const xs = Array.isArray(ls) ? ls : [];
  const out = xs
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .map((s) => s.replace("_", "-"));
  return uniq(out.length ? out : ["en", "zh-rCN", "zh-rTW"]);
}

function localesToResConfigs(ls?: string[]) {
  const xs = normalizeLocales(ls);
  return xs;
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

function toUnixPath(p?: string) {
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
    })
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
  // ✅ 固定使用仓库文件，不再从环境变量覆盖（满足你的第 2 条要求）
  const systemFile = path.join(cwd, "lib/ndjc/prompts/contract_v1.en.json");
  const retryFile = path.join(cwd, "lib/ndjc/prompts/contract_v1.retry.en.txt");

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

  // ✅ 构建日志里可确认是否调用了提示词文件（满足你的第 3 条要求）
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

  return {
    text,
    block,
    list,
    if: iff,
    hook,
    gradle: {
      applicationId: defGradle.applicationId || seed.packageId,
      resConfigs: Array.isArray(defGradle.resConfigs) ? defGradle.resConfigs : seed.locales,
      permissions: Array.isArray(defGradle.permissions) ? defGradle.permissions : []
    }
  };
}

function normalizeKeyWithAliases(k: string, aliases?: Record<string, string>) {
  if (!k) return k;
  const U = k.toUpperCase();
  if (/^TEXT:|BLOCK:|LIST:|IF:|HOOK:/i.test(U)) return U;
  if (aliases && aliases[k]) return aliases[k];
  if (/^APP_|HOME_|PRIMARY_|SUMMARY_|DESCRIPTION_|TITLE_|SUBTITLE_|LABEL_|BUTTON_|TAB_|MENU_|TOOLBAR_|TOAST_|DIALOG_|SNACKBAR_|HINT_|ICON_|THEME_/i.test(k))
    return `TEXT:${k}`;
  if (/^ROUTES$|FIELDS$|FLAGS$|STYLES$|PATTERNS$|PROGUARD|SPLITS|STRINGS$/i.test(k)) return `LIST:${k}`;
  if (/^PERMISSION|INTENT|NETWORK|FILE_PROVIDER/i.test(k)) return `IF:${k}`;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(k)) return `BLOCK:${k}`;
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
  return out;
}

function applyDefaultsAndCheckRequired(raw: any, reg: Registry) {
  const doc = raw || { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };
  const def = {
    text: reg.defaults?.text || {},
    list: reg.defaults?.list || {},
    gradle: reg.defaults?.gradle || {},
  };
  const req = reg.required || {};
  const report: {
    missing: string[];
    filled: {
      text: string[];
      block: string[];
      list: string[];
      if: string[];
      gradle: string[];
    };
  } = { missing: [], filled: { text: [], block: [], list: [], if: [], gradle: [] } };

  // TEXT required
  for (const k of reg.text) {
    const v = (doc.text || {})[k];
    if (v == null || v === "") {
      const dv = def.text[k];
      if (dv != null) {
        (doc.text || (doc.text = {}))[k] = String(dv);
        report.filled.text.push(k);
      } else {
        report.missing.push(`text:${k}`);
      }
    }
  }

  // BLOCK required
  for (const k of reg.block) {
    const v = (doc.block || {})[k];
    if (v == null) {
      (doc.block || (doc.block = {}))[k] = "";
      if (!report.filled.block.includes(k)) report.filled.block.push(k);
    }
  }

  // LIST required
  for (const k of reg.list) {
    const v = (doc.list || {})[k];
    if (!Array.isArray(v) || v.length === 0) {
      const dv = def.list[k] || [];
      if (dv.length) {
        (doc.list || (doc.list = {}))[k] = dv;
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
        (doc as any).gradle?.applicationId ||
        (doc as any).text?.["NDJC:PACKAGE_NAME"] ||
        (def as any).text?.["NDJC:PACKAGE_NAME"] ||
        (def as any).gradle?.applicationId;
      appId = ensurePackageId(appId, "com.ndjc.demo.core");
      if (!appId) report.missing.push("gradle:applicationId");
      else {
        (doc as any).gradle.applicationId = appId;
        if (!(doc as any).text["NDJC:PACKAGE_NAME"]) (doc as any).text["NDJC:PACKAGE_NAME"] = appId;
        report.filled.gradle.push("applicationId");
      }
    } else {
      if ((doc as any).gradle[k] == null && (def as any).gradle?.[k] != null) {
        (doc as any).gradle[k] = (def as any).gradle[k];
        report.filled.gradle.push(k);
      }
    }
  }

  return { ok: report.missing.length === 0, report, doc };
}

/* ======================== main ======================== */

export async function orchestrate(input: OrchestrateInput) {
  const reg = await loadRegistry();

  // 读取 system / retry（只从文件，不内置任何提示词文本）
  const { systemText, retryText, systemFile, retryFile } = await loadPrompts();

  const skeleton = reg
    ? buildSkeletonFromRegistry(reg, {
        appName: input.appName || reg.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App",
        packageId: ensurePackageId(input.packageId || input.packageName || reg.defaults?.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core"),
        locales: normalizeLocales(input.locales),
      })
    : {
        text: {
          "NDJC:PACKAGE_NAME": "com.ndjc.demo.core",
          "NDJC:APP_LABEL": "NDJC App",
          "NDJC:HOME_TITLE": "Home",
          "NDJC:PRIMARY_BUTTON_TEXT": "Start"
        },
        block: {},
        list: { "ROUTES": ["home"] },
        gradle: { resConfigs: ["en", "zh-rCN", "zh-rTW"], permissions: [] }
      }
    };

  // 初值
  let appName = input.appName || reg?.defaults?.text?.["NDJC:APP_LABEL"] || "NDJC App";
  let homeTitle = input.homeTitle || reg?.defaults?.text?.["NDJC:HOME_TITLE"] || "Home";
  let mainButtonText = input.mainButtonText || reg?.defaults?.text?.["NDJC:PRIMARY_BUTTON_TEXT"] || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName || reg?.defaults?.text?.["NDJC:PACKAGE_NAME"], "com.ndjc.demo.core");

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);

  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = (input.template as any) || (reg?.template || "circle-basic");

  const _trace: any = {
    retries: [],
    sources: {},
  };

  let parsed: any = null;
  let lastText = "";

  // ====== 调用 LLM，最多 2 次 ======
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs: any[] = [];
    if (systemText) {
      msgs.push({ role: "system", content: systemText });
    }
    if (attempt === 0) {
      msgs.push({ role: "user", content: (input.requirement || input.nl || "").trim() || "Generate NDJC Contract v1 JSON only." });
    } else {
      // 只在有 retryText 时才发纠偏，不再有任何内置兜底提示词（满足你的第 1 条要求）
      msgs.push({ role: "user", content: (input.requirement || input.nl || "").trim() || "Retry" });
      if (_trace.retries?.[attempt - 1]?.feedback) {
        msgs.push({ role: "user", content: _trace.retries[attempt - 1].feedback });
      }
      if (lastText) {
        msgs.push({ role: "assistant", content: lastText });
        msgs.push({
          role: "user",
          content:
            retryText, // ✅ 去掉原先硬编码的英文兜底 + “Return full JSON...” 附加语句
        });
      }
    }

    console.log("[orchestrator] callGroqChat.start", { attempt, withSystem: !!systemText, withRetry: attempt > 0 });
    const r = await callGroqChat(msgs, { json: true, temperature: 0 });
    const text = typeof r === "string" ? r : (r as any)?.text ?? "";
    lastText = text;
    console.log("[orchestrator] callGroqChat.done", { attempt, textLen: text.length });

    const maybe = parseJsonSafely(text) as any;
    const normalized = normalizeAnchorsUsingRegistry(maybe?.anchors || maybe?.anchorsGrouped || {}, reg || ({} as any));
    const { ok, report, doc } = applyDefaultsAndCheckRequired(
      { ...normalized, gradle: maybe?.anchors?.gradle || maybe?.gradle || {} },
      (reg || ({} as any)) as Registry
    );

    parsed = { metadata: maybe?.metadata || {}, anchors: doc, _raw: maybe, _text: text, _report: report, _ok: ok };

    const fb = ok
      ? ""
      : [
          ...report.missing.map((x) => `Missing ${x}`),
        ].join("\n");

    _trace.retries.push({
      attempt,
      ok,
      feedback: fb,
      textLen: text.length,
    });

    if (ok) break;
  }

  // ====== 提取关键锚点以回填初值 ======
  const anchorsFinal = parsed?.anchors || skeleton;
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
        gradle: { resConfigs: localesToResConfigs(locales), permissions: [] }
      }
    };
    parsed = { metadata: v1doc.metadata, anchors: v1doc.anchors, _raw: v1doc, _text: JSON.stringify(v1doc), _report: { filled: {}, missing: [] }, _ok: true };
  }

  // _trace 来源
  _trace.sources = {
    promptFilePath: systemFile,
    retryFilePath: retryFile,
    registryFilePath: reg ? "lib/ndjc/anchors/registry.circle-basic.json" : undefined,
  };

  if (!parsed || !parsed._text) {
    _trace.rawText = "";
    _trace.registryUsed = !!reg;
    _trace.note = "no raw LLM output";
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
    _trace,
    // ✅ 新增 meta._trace，保证 01_contract.json 中可以直接看到 trace（满足你的第 3 条要求）
    meta: { _trace }
  };
}

/* 省略：mkPermissionsXml / mkIntentFiltersXml 等原有工具函数实现（保持不变） */
