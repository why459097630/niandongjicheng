// lib/ndjc/orchestrator.ts
// 作用：把自然语言需求编排为“轻量结构化结果”，供后续 buildPlan/CI 使用。
// - A 模式：仅抽取字段（appName/homeTitle/...），不返回伴生文件
// - B 模式：在严格 JSON 主体外，允许返回 companions（仍由后端做白名单与沙箱落地）
// - 始终尽量返回 _trace（若底层 groqChat 支持）

import { groqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** 伴生文件（仅 B 模式可能返回/使用） */
type Companion = {
  path: string;
  content: string;
  overwrite?: boolean;
  kind?: "kotlin" | "xml" | "json" | "md" | "txt";
};

type OrchestrateInput = NdjcRequest & {
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
  permissions?: string[];
  intentHost?: string | null;
  locales?: string[];
  resConfigs?: string;
  proguardExtra?: string;
  packagingRules?: string;

  /** B 模式下可能返回（或直传） */
  _companions?: Companion[];

  /** 可选：开发者补充提示，会被拼接到 system 提示中（避免使用 role:'developer'） */
  developerNotes?: string;

  /** 透传给 groqChat 的选项（route.ts 会传入） */
  provider?: string;
  model?: string;
  forceProvider?: string;
  temperature?: number;
};

type OrchestrateOutput = {
  template: "circle-basic" | "core" | "simple" | "form";
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
  themeOverridesXml?: string;

  // 方案 B 附件
  companions: Companion[];

  /** 调试/审计：若在线调用 LLM，这里带回原始请求/响应轨迹（供 route.ts 落盘） */
  _trace?: any | null;

  // （可选）直传到 buildPlan 的通道：lists/features/hooks/resources
  lists?: Record<string, any[]>;
  features?: Record<string, any>;
  hooks?: Record<string, string>;
  resources?: any;
};

/* ----------------- helpers ----------------- */

function ensurePackageId(input?: string, fallback = "com.ndjc.demo.core") {
  let v = (input || "").trim();
  if (!v) return fallback;
  v = v
    .replace(/[^a-zA-Z0-9_.]+/g, "")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.+/g, ".");
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

// 统一路径分隔符
function toUnixPath(p: string) {
  return (p || "")
    .replace(/^[\\/]+/, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/");
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

// 兼容 groqChat 可能返回 string 或 { text, trace }
function unwrapChat(r: any) {
  if (typeof r === "string") return { text: r, trace: null };
  return { text: r?.text ?? "", trace: r?.trace ?? null };
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  // 1) 初始默认值（可被入参/LLM覆盖）
  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Hello NDJC";
  let mainButtonText = input.mainButtonText || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName, "com.ndjc.demo.app");

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);
  let lists: Record<string, any[]> | undefined;
  let features: Record<string, any> | undefined;
  let hooks: Record<string, string> | undefined;
  let resources: any;

  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  const mode: "A" | "B" = input.mode === "B" ? "B" : "A";
  const allowCompanions = !!input.allowCompanions && mode === "B";

  /** 调试轨迹（若在线调用 LLM 会被赋值） */
  let _trace: any | null = null;

  // 2) 若给了自然语言，按模式走 LLM
  if (input.requirement?.trim()) {
    const wrapSystem = (system: string) => {
      const dev = (input.developerNotes || "").trim();
      return dev ? `${system}\n\n---\n# Developer Notes\n${dev}` : system;
    };

    if (mode === "A") {
      // —— 方案A：只让 LLM 抽结构化字段（严格 JSON）——
      const sysBase =
`You are a JSON API. Reply ONLY JSON with keys:
{
  "appName": string,
  "homeTitle": string,
  "mainButtonText": string,
  "packageId": string | null,
  "permissions": string[],
  "intentHost": string | null,
  "locales": string[],
  "lists"?: object,           // 可选，e.g. { "LIST:ROUTES": ["home","detail"] }
  "features"?: object,        // 可选
  "hooks"?: object,           // 可选
  "resources"?: object        // 可选
}`;
      const sys = wrapSystem(sysBase);

      try {
        const r = await groqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          {
            json: true,
            temperature: input.temperature ?? 0,
            provider: (input as any).provider,
            model: (input as any).model,
            forceProvider: (input as any).forceProvider,
          }
        );
        const { text, trace } = unwrapChat(r);
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
          if (j.lists && typeof j.lists === "object") lists = j.lists;
          if (j.features && typeof j.features === "object") features = j.features;
          if (j.hooks && typeof j.hooks === "object") hooks = j.hooks;
          if (j.resources && typeof j.resources === "object") resources = j.resources;
        }
      } catch {
        // 保底：忽略 LLM 错误
      }
    } else if (mode === "B" && allowCompanions) {
      // —— 方案B：JSON 主体 + 伴生文件（仍强制外层 JSON）——
      const sysBase =
`你是移动端生成助手。以严格 JSON 返回（不可包含代码块标记）：
{
  "fields": {
    "appName": string,
    "homeTitle": string,
    "mainButtonText": string,
    "packageId": string | null,
    "permissions": string[],
    "intentHost": string | null,
    "locales": string[],
    "lists"?: object,
    "features"?: object,
    "hooks"?: object,
    "resources"?: object
  },
  "companions": [
    { "path": "app/src/main/java/...", "kind":"kotlin|xml|json|md|txt", "content": "...", "overwrite": false }
  ]
}`;
      const sys = wrapSystem(sysBase);

      try {
        const r = await groqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          {
            json: true,
            temperature: input.temperature ?? 0.3,
            provider: (input as any).provider,
            model: (input as any).model,
            forceProvider: (input as any).forceProvider,
          }
        );
        const { text, trace } = unwrapChat(r);
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

          if (f.lists && typeof f.lists === "object") lists = f.lists;
          if (f.features && typeof f.features === "object") features = f.features;
          if (f.hooks && typeof f.hooks === "object") hooks = f.hooks;
          if (f.resources && typeof f.resources === "object") resources = f.resources;

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
    template: (input.template as any) || "circle-basic",
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

    // 直传附加结构（buildPlan 会兜底吸收）
    lists,
    features,
    hooks,
    resources,
  };

  return out;
}
