// lib/ndjc/orchestrator.ts
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** 伴生文件（仅 B 模式可能返回/使用） */
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

  // 可选：显式要求 v1
  contract?: "v1" | "legacy";
  contractV1?: boolean;

  // 可选：显式切换模板
  template?: "core" | "simple" | "form" | "circle-basic";
};

export type OrchestrateOutput = {
  template: "core" | "simple" | "form" | "circle-basic";
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

/* ----------------- 注册表（极简版） ----------------- */

type AnchorRegistry = {
  version?: string;
  templateKey?: string;
  textAnchors?: Array<{ key: string } | string>;
  blockAnchors?: string[];
  listAnchors?: string[];
  ifAnchors?: string[];
  hookAnchors?: string[];
  resourceAnchors?: string[];
  aliases?: Record<string, string>;
  companions?: {
    allowGlobs?: string[];
    denyOverwrite?: string[];
    sizeLimitBytes?: number;
    perFileLimitBytes?: number;
  };
};

function canonKey(k: string) {
  const s = String(k || "").trim();
  if (!s) return s;
  if (/^(ndjc|block|list|if|hook|res):/i.test(s)) {
    const [p, rest] = s.split(":");
    return p.toUpperCase() + ":" + rest.toUpperCase().replace(/\s+/g, "_");
  }
  return s.toUpperCase();
}

function loadRegistry(): AnchorRegistry {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reg = require("../anchors/registry.circle-basic.json");
    return reg as AnchorRegistry;
  } catch {
    return {};
  }
}

function summarizeRegistryForPrompt(reg: AnchorRegistry) {
  const asKeys = (arr?: Array<{ key: string } | string>) =>
    (arr || []).map((x: any) => (typeof x === "string" ? x : x?.key || "")).filter(Boolean);

  const text = asKeys(reg.textAnchors || []).map(canonKey);
  const block = (reg.blockAnchors || []).map(canonKey);
  const list = (reg.listAnchors || []).map(canonKey);
  const iff = (reg.ifAnchors || []).map(canonKey);
  const hook = (reg.hookAnchors || []).map(canonKey);
  const res = (reg.resourceAnchors || []).map(canonKey);

  // 控制体量：这里不做截断，template 子集已够小；若后续要缩小，可 slice
  return {
    version: reg.version || "unknown",
    templateKey: reg.templateKey || "circle-basic",
    text, block, list, iff, hook, res,
    companions: {
      allow: reg.companions?.allowGlobs || [],
      deny: reg.companions?.denyOverwrite || [],
      sizeLimitBytes: reg.companions?.sizeLimitBytes || 2 * 1024 * 1024,
      perFileLimitBytes: reg.companions?.perFileLimitBytes || 200 * 1024
    }
  };
}

/* ----------------- helpers ----------------- */

// v1 开关：入参/环境变量二选一
function wantV1(input: Partial<OrchestrateInput>): boolean {
  const envRaw = (process.env.NDJC_CONTRACT_V1 || "").trim().toLowerCase();
  return (
    input.contract === "v1" ||
    input.contractV1 === true ||
    envRaw === "1" || envRaw === "true" || envRaw === "v1"
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
  const list = (perms || []).map(p => (p || "").trim()).filter(Boolean);
  if (!list.length) return undefined;
  return list.map(p => `<uses-permission android:name="${p}"/>`).join("\n");
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
  const arr = (locales || []).map(s => (s || "").trim()).filter(Boolean);
  return arr.length ? arr : ["en", "zh-rCN", "zh-rTW"];
}
function localesToResConfigs(locales: string[]) {
  return locales.join(",");
}

function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
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
    out.push({ path: rel, content: typeof it.content === "string" ? it.content : "", overwrite: !!it.overwrite, kind: it.kind });
  }
  return out;
}

/** 把当前编排结果组装成 Contract v1 文档（最小满足校验集） */
function makeV1Doc(opts: {
  runId?: string | null;
  template: string;
  mode: "A" | "B";
  appName: string;
  homeTitle: string;
  mainButtonText: string;
  packageId: string;
  resConfigsCsv?: string;
  permissions?: string[];
  companions?: Companion[];
}) {
  const resConfigsArr = (opts.resConfigsCsv || "")
    .split(",").map(s => s.trim()).filter(Boolean);

  const files = (opts.mode === "B" && Array.isArray(opts.companions))
    ? opts.companions.map(f => ({
        path: f.path,
        content: f.content,
        encoding: "utf8" as const,
        kind: (f.kind || "txt"),
      }))
    : [];

  return {
    metadata: {
      runId: opts.runId || undefined,
      template: opts.template,
      appName: opts.appName,
      packageId: opts.packageId,
      mode: opts.mode,
    },
    anchors: {
      text: {
        "NDJC:PACKAGE_NAME": opts.packageId,
        "NDJC:APP_LABEL": opts.appName,
        "NDJC:HOME_TITLE": opts.homeTitle || opts.appName,
        "NDJC:PRIMARY_BUTTON_TEXT": opts.mainButtonText || "Start",
      },
      block: {},
      list: {
        "LIST:ROUTES": ["home"],
      },
      if: {},
      // 可留空：校验器允许存在空对象
      res: {},
      hook: {},
      gradle: {
        applicationId: opts.packageId,
        resConfigs: resConfigsArr,
        permissions: opts.permissions || [],
      },
    },
    // patches 里把 gradle/manifest 的增量也填上（最小集）
    patches: {
      gradle: {
        resConfigs: resConfigsArr,
        permissions: opts.permissions || [],
      },
      manifest: {
        permissions: opts.permissions || [],
      },
    },
    // B 模式伴生文件
    files,
    // 兼容 contractv1-to-plan 的另一路读取（非必须）
    resources: {},
  };
}

/* ----------------- V1 专用：带注册表约束的系统提示 ----------------- */

function buildV1SystemPromptFromRegistry(regSummary: ReturnType<typeof summarizeRegistryForPrompt>) {
  const toEnum = (arr: string[]) => arr.map(s => `"${s}"`).join(", ");

  return `你是 NDJC 的编排助手。请严格输出 **Contract V1** JSON（不要包含 Markdown 代码块围栏）。
必须遵守以下约束：
- 模板：${regSummary.templateKey}；注册表版本：${regSummary.version}
- 只允许使用以下锚点键名（大小写按列出者）：
  * text: [${toEnum(regSummary.text)}]
  * block: [${toEnum(regSummary.block)}]
  * list: [${toEnum(regSummary.list)}]
  * if:   [${toEnum(regSummary.iff)}]
  * hook: [${toEnum(regSummary.hook)}]
  * res:  [${toEnum(regSummary.res)}]
- 伴生文件（可选，仅 B 模式）：路径允许匹配任一 allowGlobs，且不得覆盖 denyOverwrite；单文件大小 <= ${regSummary.companions.perFileLimitBytes}，总大小 <= ${regSummary.companions.sizeLimitBytes}。
- 未列出的键一律禁止出现。

输出 JSON 结构（字段不可缺失）：
{
  "metadata": {
    "template": "circle-basic",
    "mode": "A" | "B",
    "appName": string,
    "packageId": string,
    "runId": string | null
  },
  "anchors": {
    "text": { "<text-key>": string, ... },
    "block": { "<block-key>": string, ... },
    "list": { "<list-key>": string[] | string, ... },
    "if": { "<if-key>": boolean | "true" | "false" | 0 | 1, ... },
    "res": { "<res-key>": string, ... },
    "hook": { "<hook-key>": string | string[], ... },
    "gradle": {
      "applicationId": string,
      "resConfigs": string[],
      "permissions": string[]
    }
  },
  "patches": {
    "gradle": { "resConfigs": string[], "permissions": string[] },
    "manifest": { "permissions": string[] }
  },
  "files": [
    { "path": "src/main/java/{PACKAGE_PATH}/Feature.kt", "content": "...", "encoding": "utf8", "kind": "kotlin" }
  ],
  "resources": {}
}

注意：
- list 值可以是 string 或 string[]，实现方会兼容解析；
- text 中至少包含 "NDJC:PACKAGE_NAME"、"NDJC:APP_LABEL"、"NDJC:HOME_TITLE"、"NDJC:PRIMARY_BUTTON_TEXT"；
- 如果没有合适的 block/hook/list/if/res，可留空对象。`;
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  // 默认字段
  let appName = input.appName || "NDJC core";
  let homeTitle = input.homeTitle || "Hello core";
  let mainButtonText = input.mainButtonText || "Start core";
  let packageId = ensurePackageId(input.packageId || input.packageName, "com.ndjc.demo.core");

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);

  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = input.mode === "B" ? "B" : "A";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template: OrchestrateOutput["template"] = (input.template as any) || "circle-basic";

  let _trace: any | null = null;

  // 如果启用 V1：优先让 LLM 在注册表约束下直接产出 V1 合同 JSON
  if (wantV1(input)) {
    const reg = loadRegistry();
    const regSum = summarizeRegistryForPrompt(reg);
    const sys = buildV1SystemPromptFromRegistry(regSum);
    const dev = (input.developerNotes || "").trim();
    const system = dev ? `${sys}\n\n---\n# Developer Notes\n${dev}` : sys;

    try {
      if (input.requirement?.trim()) {
        const r = await callGroqChat(
          [
            { role: "system", content: system },
            { role: "user", content: input.requirement! }
          ],
          { json: true, temperature: 0 }
        );
        const text = typeof r === "string" ? r : (r as any)?.text ?? "";
        const doc = parseJsonSafely(text);

        if (doc && doc.metadata && doc.anchors) {
          // 回写少量顶层字段，便于前端 UI 显示
          appName = doc.metadata.appName || appName;
          packageId = ensurePackageId(doc.metadata.packageId || packageId, packageId);

          // 兼容 text 锚点里放了这些值
          const t = (doc.anchors?.text || {}) as Record<string, string>;
          homeTitle = t["NDJC:HOME_TITLE"] || homeTitle;
          mainButtonText = t["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;

          // 伴生文件（若 LLM 给了，且允许）
          if (allowCompanions && Array.isArray(doc.files)) {
            companions = sanitizeCompanions(
              (doc.files as any[]).map(f => ({
                path: f.path,
                content: f.content,
                kind: f.kind,
                overwrite: !!f.overwrite
              }))
            );
          }

          _trace = { rawText: JSON.stringify(doc) };
        } else {
          // Fallback：用最小 V1 保底
          const v1doc = makeV1Doc({
            runId: (input as any).runId || null,
            template,
            mode,
            appName,
            homeTitle,
            mainButtonText,
            packageId,
            resConfigsCsv: input.resConfigs || localesToResConfigs(locales),
            permissions,
            companions: allowCompanions ? companions : []
          });
          _trace = { rawText: JSON.stringify(v1doc), note: "fallback:minimal-v1" };
        }
      } else {
        // 无 requirement，直接最小 V1
        const v1doc = makeV1Doc({
          runId: (input as any).runId || null,
          template,
          mode,
          appName,
          homeTitle,
          mainButtonText,
          packageId,
          resConfigsCsv: input.resConfigs || localesToResConfigs(locales),
          permissions,
          companions: allowCompanions ? companions : []
        });
        _trace = { rawText: JSON.stringify(v1doc), note: "fallback:minimal-v1:no-requirement" };
      }
    } catch {
      const v1doc = makeV1Doc({
        runId: (input as any).runId || null,
        template,
        mode,
        appName,
        homeTitle,
        mainButtonText,
        packageId,
        resConfigsCsv: input.resConfigs || localesToResConfigs(locales),
        permissions,
        companions: allowCompanions ? companions : []
      });
      _trace = { rawText: JSON.stringify(v1doc), note: "fallback:minimal-v1:error" };
    }
  } else {
    // —— legacy 路径：保持你的 A/B 流程（字段抽取 + 可选伴生）——
    if (input.requirement?.trim()) {
      const wrapSystem = (system: string) => {
        const dev = (input.developerNotes || "").trim();
        return dev ? `${system}\n\n---\n# Developer Notes\n${dev}` : system;
      };
      const unwrap = (r: any) =>
        (typeof r === "string" ? { text: r, trace: null } : { text: r?.text ?? "", trace: r?.trace ?? null });

      // —— 路线 A：仅抽字段（兼容 legacy）——
      const sysA = wrapSystem(
`You are a JSON API. Reply ONLY JSON with keys:
{
  "appName": string,
  "homeTitle": string,
  "mainButtonText": string,
  "packageId": string | null,
  "permissions": string[],
  "intentHost": string | null,
  "locales": string[]
}`
      );

      // —— 路线 B：字段 + 伴生文件（兼容 legacy）——
      const sysB = wrapSystem(
`你是移动端生成助手。以严格 JSON 返回（不可包含代码块标记）：
{
  "fields": {
    "appName": string,
    "homeTitle": string,
    "mainButtonText": string,
    "packageId": string | null,
    "permissions": string[],
    "intentHost": string | null,
    "locales": string[]
  },
  "companions": [
    { "path": "app/src/main/java/...", "kind":"kotlin|xml|json|md|txt", "content": "...", "overwrite": false }
  ]
}`
      );

      try {
        if (mode === "A") {
          const r = await callGroqChat(
            [
              { role: "system", content: sysA },
              { role: "user", content: input.requirement! },
            ],
            { json: true, temperature: 0 }
          );
          const { text, trace } = unwrap(r);
          _trace = trace || { rawText: text };
          const j = parseJsonSafely(text) as any;
          if (j) {
            appName        = j.appName        || appName;
            homeTitle      = j.homeTitle      || homeTitle;
            mainButtonText = j.mainButtonText || mainButtonText;
            packageId      = ensurePackageId(j.packageId || packageId, packageId);
            if (Array.isArray(j.permissions)) permissions = j.permissions;
            if (typeof j.intentHost === "string" || j.intentHost === null) intentHost = j.intentHost;
            if (Array.isArray(j.locales) && j.locales.length) locales = normalizeLocales(j.locales);
          }
        } else if (mode === "B" && allowCompanions) {
          const r = await callGroqChat(
            [
              { role: "system", content: sysB },
              { role: "user", content: input.requirement! },
            ],
            { json: true, temperature: 0.3 }
          );
          const { text, trace } = unwrap(r);
          _trace = trace || { rawText: text };
          const j = parseJsonSafely(text) as any;
          if (j) {
            const f = j.fields || {};
            appName        = f.appName        || appName;
            homeTitle      = f.homeTitle      || homeTitle;
            mainButtonText = f.mainButtonText || mainButtonText;
            packageId      = ensurePackageId(f.packageId || packageId, packageId);
            if (Array.isArray(f.permissions)) permissions = f.permissions;
            if (typeof f.intentHost === "string" || f.intentHost === null) intentHost = f.intentHost;
            if (Array.isArray(f.locales) && f.locales.length) locales = normalizeLocales(f.locales);

            companions = sanitizeCompanions(Array.isArray(j.companions) ? (j.companions as Companion[]) : []);
          }
        }
      } catch {
        // swallow：沿用默认
      }
    }
  }

  // 块锚点需要的 XML 片段（legacy 路径或 UI 预览需要）
  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;

  // resConfigs：优先入参，其次由 locales 推导
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 若 V1 路径未生成 _trace（无 requirement 时），兜底最小 V1
  if (wantV1(input) && !_trace) {
    const v1doc = makeV1Doc({
      runId: (input as any).runId || null,
      template,
      mode,
      appName,
      homeTitle,
      mainButtonText,
      packageId,
      resConfigsCsv: resConfigs,
      permissions,
      companions: allowCompanions ? companions : [],
    });
    _trace = { rawText: JSON.stringify(v1doc), note: "fallback:minimal-v1:post-check" };
  }

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
