// lib/ndjc/orchestrator.ts
import { groqChat } from "@/lib/ndjc/groq";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { NdjcRequest } from "./types";

/** 伴生文件（仅 B 模式可能返回/使用） */
type Companion = {
  path: string;
  content: string;
  overwrite?: boolean;
  kind?: "kotlin" | "xml" | "json" | "md" | "txt";
};

export type OrchestrateInput = NdjcRequest & {
  /** 自然语言需求 */
  requirement?: string;

  /** 工作模式：A = 只抽字段；B = 允许伴生代码（实验） */
  mode?: "A" | "B";

  /** 仅 B 模式下有效：是否允许伴生文件 */
  allowCompanions?: boolean;

  /** 这些可被 A/B 模式或调用方直接提供，优先级：入参 > LLM > 默认 */
  appName?: string;
  homeTitle?: string;
  mainButtonText?: string;
  packageId?: string;
  packageName?: string;

  /** 扩展字段（抽取或直传），供块锚点/Gradle 使用 */
  permissions?: string[];      // ["android.permission.INTERNET", ...]
  intentHost?: string | null;  // 比如 "example.com"
  locales?: string[];          // ["en","zh-rCN","zh-rTW"]
  resConfigs?: string;         // "en,zh-rCN,zh-rTW"
  proguardExtra?: string;      // ",'proguard-ndjc.pro'"
  packagingRules?: string;     // Gradle packaging{} 片段

  /** B 模式下可能返回 */
  _companions?: Companion[];

  /** —— 新增：Contract v1 开关与调用细节 —— */
  contract?: "v1";
  contractV1?: boolean;

  /** 可选：强制选择 LLM 提供商与模型（route.ts 会传入） */
  provider?: "groq";
  forceProvider?: "groq";
  model?: string;

  /** 可选：覆盖默认的 system/dev 提示词路径 */
  systemPath?: string;
  developerPath?: string;
};

export type OrchestrateOutput = {
  template: "core" | "simple" | "form" | "circle-basic";
  mode: "A" | "B";
  allowCompanions: boolean;

  appName: string;
  homeTitle: string;
  mainButtonText: string;
  packageId: string;

  // Sprint5/6 & 扩展
  locales: string[];
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;

  // 供块锚点注入的 XML 片段
  permissionsXml?: string;
  intentFiltersXml?: string;
  themeOverridesXml?: string; // 可选（未抽到则留空）

  // 方案 B 附件
  companions: Companion[];

  /**
   * 调试/审计：
   * - 对于 A/B 模式：trace/请求/响应
   * - 对于 Contract v1：system/dev 文本、user 文本、rawText
   */
  _trace?: any | null;
};

/* ----------------- helpers ----------------- */

function ensurePackageId(input?: string, fallback = "com.ndjc.demo.core") {
  let v = (input || "").trim();
  if (!v) return fallback;
  // 粗略清洗：只保留字母/数字/下划线/点；首尾去点；多个点折叠
  v = v.replace(/[^a-zA-Z0-9_.]+/g, "")
       .replace(/^\.+|\.+$/g, "")
       .replace(/\.+/g, ".");
  if (!v) return fallback;
  return v.toLowerCase();
}

function mkPermissionsXml(perms?: string[]) {
  const list = (perms || [])
    .map(p => (p || "").trim())
    .filter(Boolean);
  if (!list.length) return undefined;
  return list.map(p => `<uses-permission android:name="${p}"/>`).join("\n");
}

function mkIntentFiltersXml(host?: string | null) {
  const h = (host || "").trim();
  if (!h) return undefined;
  // 简化：VIEW + DEFAULT + BROWSABLE + https scheme 指定 host
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
  // Gradle resConfigs 期望逗号分隔
  return locales.join(",");
}

// 允许把 ```json ... ``` 包裹的内容剥出来再 parse
function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 统一路径分隔符（不使用 String.prototype.replaceAll）
function toUnixPath(p: string) {
  return (p || "")
    .replace(/^[\\/]+/, "")  // 开头多余斜杠
    .replace(/\\/g, "/")     // 反斜杠 -> 正斜杠
    .replace(/\/+/g, "/");   // 连续斜杠 -> 单个
}

// 过滤/规范化 companions，避免无效或危险路径
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
      kind: it.kind,
    });
  }
  return out;
}

/* ----------------- Contract v1: 加载 system/dev 提示词（可覆盖路径） ----------------- */

async function loadPromptText(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return "";
  }
}

async function loadContractV1Prompts(input: OrchestrateInput) {
  const sysPath = input.systemPath || path.join(process.cwd(), "config/llm/system-prompts/ndjc-android-contract-v1.md");
  const devPath = input.developerPath || path.join(process.cwd(), "config/llm/developer-prompts/ndjc-android-contract-v1.md");

  const [system, developer] = await Promise.all([loadPromptText(sysPath), loadPromptText(devPath)]);

  const fallbackSystem =
`你是 Android 代码生成器。只输出符合 NDJC Android Contract v1 的 JSON。不得输出解释文字/代码块。仅 Kotlin + Jetpack Compose，权限最小化，applicationId==metadata.packageId。`;
  const fallbackDeveloper =
`请生成 Contract v1 JSON：包含 metadata、patches、files、anchors(text/block/list/if/gradle)。禁止 XML 布局，路径使用 {PACKAGE_PATH}。gradle.applicationId 必须等于 metadata.packageId。`;

  return {
    system: system?.trim() ? system : fallbackSystem,
    developer: developer?.trim() ? developer : fallbackDeveloper,
  };
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  // 1) 初始默认值（可被入参/LLM覆盖）
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

  /** 调试轨迹（若在线调用 LLM 会被赋值） */
  let _trace: any | null = null;

  const wantContractV1 = input.contract === "v1" || input.contractV1 === true || process.env.NDJC_CONTRACT_V1 === "1";

  // 2) 若给了自然语言，按模式走 LLM
  if (input.requirement?.trim()) {
    // 一个小工具：兼容 groqChat 可能返回 string 或 {text,trace}
    const unwrap = (r: any) => {
      if (typeof r === "string") return { text: r, trace: null };
      return { text: r?.text ?? "", trace: r?.trace ?? null };
    };

    if (wantContractV1) {
      // —— 新增：Contract v1 路线：让 LLM 直接产出契约 JSON，后续由 route.ts 做校验+映射为 plan ——
      const { system, developer } = await loadContractV1Prompts(input);

      // 将用户意图、默认值及已知上下文压缩为 User 消息，便于 LLM 生成更一致的 metadata
      const userPayload = {
        requirement: input.requirement,
        template: (input.template as any) || "circle-basic",
        // 这些只是提示，最终以 LLM 返回 JSON 为准
        defaults: {
          appName,
          packageId,
          locales,
          entry_activity: "{PACKAGE_ID}.MainActivity"
        }
      };

      try {
        const r = await groqChat(
          [
            { role: "system", content: system },
            { role: "developer", content: developer },
            { role: "user", content: JSON.stringify(userPayload) }
          ],
          // 让底层尽量以 JSON 返回，但我们仍会把 text 原样透传给 route.ts 落盘与校验
          { json: true, temperature: 0 }
        );
        const { text, trace } = unwrap(r);

        _trace = {
          provider: input.forceProvider || input.provider || "groq",
          model: input.model || "llama-3.1-8b-instant",
          request: { system, developer, user: userPayload },
          response: trace ?? null,
          rawText: text
        };

        // Contract v1 的字段不在 orchestrator 内部解析；维持原有输出字段占位即可（route.ts 会用 v1→plan 覆盖 plan）
        // 这里不改变 appName/packageId 等占位，以保证旧链路也可用
      } catch (err: any) {
        _trace = { error: String(err?.message ?? err) };
        // 降级：让后续仍可走旧链路（buildPlan(o)），并在 route.ts 里看到 01_orchestrator_mode.txt=offline(...)
      }
    } else if (mode === "A") {
      // —— 方案A：只让 LLM 抽结构化字段（严格 JSON）——
      const sys =
`You are a JSON API. Reply ONLY JSON with keys:
{
  "appName": string,
  "homeTitle": string,
  "mainButtonText": string,
  "packageId": string | null,
  "permissions": string[],
  "intentHost": string | null,
  "locales": string[]
}`;
      try {
        const r = await groqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          { json: true, temperature: 0 }
        );
        const { text, trace } = unwrap(r);
        _trace = trace;

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
      } catch {
        // 保底：忽略 LLM 错误，走默认值
      }
    } else if (mode === "B" && allowCompanions) {
      // —— 方案B：JSON 主体 + 伴生文件（仍强制外层 JSON）——
      const sys =
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
}`;
      try {
        const r = await groqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          { json: true, temperature: 0.3 }
        );
        const { text, trace } = unwrap(r);
        _trace = trace;

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

          // 伴生文件（后端会做白名单/沙箱再落地）
          companions = sanitizeCompanions(Array.isArray(j.companions) ? (j.companions as Companion[]) : []);
        }
      } catch {
        // 保底：忽略 LLM 错误
      }
    }
  }

  // 3) 组装块锚点需要的 XML 片段
  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;

  // 4) Sprint5/6 衍生：resConfigs 优先入参，否则由 locales 推导
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 5) 汇总输出（供 generator 使用）
  const out: OrchestrateOutput = {
    template: (input.template as any) || "core",
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

    // 调试轨迹：route.ts 可据此把 01a/01b/01c 审计文件写到 requests/<runId>/
    _trace,
  };

  return out;
}
