// lib/ndjc/orchestrator.ts
import { groqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

/** 伴生文件（仅 B 模式可能返回/使用） */
type Companion = {
  path: string;
  content: string;
  overwrite?: boolean;
  kind?: "kotlin" | "xml" | "json" | "md" | "txt" | "java";
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

  /** 允许调用方直传伴生（与 _companions 等价，供回放/测试） */
  companions?: Companion[];
  _companions?: Companion[];
};

type OrchestrateOutput = {
  template: string; // 与系统模板对齐：circle-basic / flow-basic / ...
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

  /** 调试/审计：若在线调用 LLM，这里带回原始请求/响应轨迹（供 route.ts 落盘） */
  _trace?: any | null;
};

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
  const list = (perms || [])
    .map((p) => (p || "").trim())
    .filter(Boolean);
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

// 允许把 ```json ... ``` 包裹的内容剥出来再 parse（以及容忍“纯 JSON 字符串”）
function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const fence =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** ---- 伴生文件清洗/白名单/规范化 ---- */
const EXT_KIND_MAP: Record<string, Companion["kind"]> = {
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".java": "java",
  ".xml": "xml",
  ".json": "json",
  ".md": "md",
  ".txt": "txt",
  ".pro": "txt",
  ".properties": "txt",
  ".gradle": "txt",
};
const EXT_ALLOW = new Set(Object.keys(EXT_KIND_MAP));
const MAX_COMPANIONS = 64;
const MAX_FILE_SIZE = 256 * 1024; // 256KB 防炸 repo

function toUnixPath(p: string) {
  return (p || "").replaceAll("\\", "/").replace(/^\/+/, "");
}
function sanitizeCompanions(list?: Companion[]): Companion[] {
  const src = Array.isArray(list) ? list : [];
  const out: Companion[] = [];
  const seen = new Set<string>();

  for (const it of src) {
    if (!it || typeof it.path !== "string") continue;
    const rel = toUnixPath(it.path);
    const ext = rel.includes(".") ? "." + rel.split(".").pop()!.toLowerCase() : "";
    if (!EXT_ALLOW.has(ext)) continue;

    const kind = it.kind || EXT_KIND_MAP[ext] || "txt";
    const content = typeof it.content === "string" ? it.content : "";
    if (!content) continue;
    if (content.length > MAX_FILE_SIZE) continue;

    // 去重（同路径仅保留第一份）
    const key = `${rel}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      path: rel,
      content,
      overwrite: !!it.overwrite,
      kind,
    });
    if (out.length >= MAX_COMPANIONS) break;
  }
  return out;
}

/** ---- 兼容 A/B 两种形态（A 可能直接给字段，或外包在 fields） ---- */
function mergeFields(
  base: {
    appName: string;
    homeTitle: string;
    mainButtonText: string;
    packageId: string;
    permissions: string[];
    intentHost: string | null;
    locales: string[];
  },
  j: any
) {
  const f = j?.fields ?? j ?? {};
  const _pkg = f.packageId ?? f.packageName;
  return {
    appName: f.appName || base.appName,
    homeTitle: f.homeTitle || base.homeTitle,
    mainButtonText: f.mainButtonText || base.mainButtonText,
    packageId: ensurePackageId(_pkg || base.packageId, base.packageId),
    permissions: Array.isArray(f.permissions) ? f.permissions : base.permissions,
    intentHost:
      typeof f.intentHost === "string" || f.intentHost === null
        ? f.intentHost
        : base.intentHost,
    locales: Array.isArray(f.locales) && f.locales.length
      ? normalizeLocales(f.locales)
      : base.locales,
  };
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  // 1) 默认值（模板默认与系统一致：circle-basic）
  const template = (input.template as any) || "circle-basic";

  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Hello NDJC";
  let mainButtonText = input.mainButtonText || "Get Started";
  let packageId = ensurePackageId(
    input.packageId || input.packageName,
    "com.ndjc.demo.app"
  );

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);

  // 兼容调用方直传 companions/_companions
  let companions: Companion[] = sanitizeCompanions(
    (input._companions as Companion[]) || (input.companions as Companion[])
  );

  const mode: "A" | "B" = input.mode === "B" ? "B" : "A";
  const allowCompanions = !!input.allowCompanions && mode === "B";

  /** 调试轨迹（若在线 LLM 会被赋值） */
  let _trace: any | null = null;

  // 2) 若传入自然语言需求，走 LLM
  if (input.requirement?.trim()) {
    // 兼容 groqChat 返回 string 或 {text, trace}
    const unwrap = (r: any) => {
      if (typeof r === "string") return { text: r, trace: null };
      return { text: r?.text ?? "", trace: r?.trace ?? null };
    };

    if (mode === "A") {
      const sys = `You are a JSON API. Reply ONLY JSON (no code fences) with keys:
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
        const j = parseJsonSafely(text);
        if (j) {
          const m = mergeFields(
            { appName, homeTitle, mainButtonText, packageId, permissions, intentHost, locales },
            j
          );
          appName = m.appName;
          homeTitle = m.homeTitle;
          mainButtonText = m.mainButtonText;
          packageId = m.packageId;
          permissions = m.permissions;
          intentHost = m.intentHost;
          locales = m.locales;
        }
      } catch {
        // 忽略 LLM 失败，保留默认/入参
      }
    } else if (mode === "B" && allowCompanions) {
      const sys = `你是移动端生成助手。请以严格 JSON 返回（不得包含\`\`\`围栏），格式如下：
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
    { "path": "app/src/main/java/...", "kind":"kotlin|java|xml|json|md|txt", "content": "...", "overwrite": false }
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

        const j = parseJsonSafely(text);
        if (j) {
          const m = mergeFields(
            { appName, homeTitle, mainButtonText, packageId, permissions, intentHost, locales },
            j
          );
          appName = m.appName;
          homeTitle = m.homeTitle;
          mainButtonText = m.mainButtonText;
          packageId = m.packageId;
          permissions = m.permissions;
          intentHost = m.intentHost;
          locales = m.locales;

          // 伴生文件（经过白名单清洗）
          companions = sanitizeCompanions(j.companions);
        }
      } catch {
        // 忽略 LLM 失败
      }
    }
  }

  // 3) 块锚点需要的 XML 片段
  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;

  // 4) resConfigs 优先入参，否则由 locales 推导
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 5) 汇总输出（供 generator 使用）
  const out: OrchestrateOutput = {
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

  return out;
}
