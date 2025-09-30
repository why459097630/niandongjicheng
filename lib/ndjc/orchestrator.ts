// lib/ndjc/orchestrator.ts
import { groqChat as callGroqChat } from "@/lib/ndjc/groq"; // ← 改成别名，避免重名冲突
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

  /** 前端可显式请求 v1（等价于环境变量 NDJC_CONTRACT_V1=1） */
  contract?: "v1" | "legacy";
  contractV1?: boolean;
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

// 允许把 ```json ... ``` 包裹的内容剥出来再 parse
function parseJsonSafely(text: string): any | null {
  if (!text) return null;
  const m =
    text.match(/```json\s*([\s\S]*?)```/i) ||
    text.match(/```\s*([\s\S]*?)```/);
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

/** 是否启用 Contract v1（环境变量或请求显式声明） */
function wantContractV1(input: OrchestrateInput) {
  const envRaw = (process.env.NDJC_CONTRACT_V1 || "").trim().toLowerCase();
  return (
    input.contract === "v1" ||
    input.contractV1 === true ||
    envRaw === "1" ||
    envRaw === "true" ||
    envRaw === "v1"
  );
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(
  input: OrchestrateInput
): Promise<OrchestrateOutput> {
  // 初始默认值（可被入参/LLM覆盖）
  let templateKey = (input.template as any) || "core";
  let appName = input.appName || "NDJC core";
  let homeTitle = input.homeTitle || "Hello core";
  let mainButtonText = input.mainButtonText || "Start core";
  let packageId = ensurePackageId(
    input.packageId || input.packageName,
    "com.ndjc.demo.core"
  );

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);

  let companions: Companion[] = Array.isArray(input._companions)
    ? sanitizeCompanions(input._companions)
    : [];

  const mode: "A" | "B" = input.mode === "B" ? "B" : "A";
  const allowCompanions = !!input.allowCompanions && mode === "B";

  /** 调试轨迹（若在线调用 LLM 会被赋值） */
  let _trace: any | null = null;

  // 仅在有自然语言需求时才调 LLM
  if (input.requirement?.trim()) {
    const wrapSystem = (system: string) => {
      const dev = (input.developerNotes || "").trim();
      return dev ? `${system}\n\n---\n# Developer Notes\n${dev}` : system;
    };
    const unwrap = (r: any) => {
      if (typeof r === "string") return { text: r, trace: null };
      return { text: r?.text ?? "", trace: r?.trace ?? null };
    };

    // =============== Contract v1 路径（优先） ===============
    if (wantContractV1(input)) {
      const sysBase = `
You are a JSON API. Return ONE JSON object ONLY (no code fences, no comments).
Keys MUST be exactly: {"metadata","fields","companions"}.

"metadata": {
  "contract": "v1",
  "template": "circle-basic",            // one of core|simple|form|circle-basic|...
  "appTitle": "<string>",                // required
  "packageName": "com.example.app"       // required; valid Java package id
},
"fields": {
  "appName": "<string>",                 // required
  "homeTitle": "<string>",               // required
  "mainButtonText": "<string>",          // required
  "packageId": "<string>",               // recommended same as metadata.packageName
  "permissions": ["<string>"],           // optional array
  "intentHost": null,                    // optional string or null
  "locales": ["en","zh-rCN"]             // optional array; include at least one if known
},
"companions": [
  {
    "path": "app/... or src/...",        // must start with app/ or src/
    "kind": "kotlin|xml|json|md|txt",
    "content": "<file content>",
    "overwrite": false
  }
]

Rules:
- Output MUST be valid JSON; DO NOT include \`\`\` fences or extra keys.
- Ensure package names match /^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$/.
- If you don't have companions, set "companions": [].
      `.trim();

      const sys = wrapSystem(sysBase);

      try {
        const r = await callGroqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          { json: true, temperature: 0 }
        );
        const { text, trace } = unwrap(r);
        _trace = trace || { rawText: text };

        const j = parseJsonSafely(text) as any;
        if (j) {
          // metadata
          const md = j.metadata || {};
          if (typeof md.template === "string" && md.template.trim()) {
            templateKey = md.template as any;
          }
          if (typeof md.appTitle === "string" && md.appTitle.trim()) {
            appName = md.appTitle;
          }
          if (typeof md.packageName === "string" && md.packageName.trim()) {
            packageId = ensurePackageId(md.packageName, packageId);
          }

          // fields
          const f = j.fields || {};
          appName = f.appName || appName;
          homeTitle = f.homeTitle || homeTitle;
          mainButtonText = f.mainButtonText || mainButtonText;
          packageId = ensurePackageId(f.packageId || packageId, packageId);

          if (Array.isArray(f.permissions)) permissions = f.permissions;
          if (typeof f.intentHost === "string" || f.intentHost === null)
            intentHost = f.intentHost;
          if (Array.isArray(f.locales) && f.locales.length)
            locales = normalizeLocales(f.locales);

          // companions（遵循 allowCompanions）
          const comp = Array.isArray(j.companions) ? (j.companions as Companion[]) : [];
          if (allowCompanions) companions = sanitizeCompanions(comp);
        }
      } catch {
        // 忽略错误，保持默认/入参
      }
    }
    // =============== 非 v1：A/B 旧路径（兼容） ===============
    else if (mode === "A") {
      const sysBase = `
You are a JSON API. Reply ONLY JSON with keys:
{
  "appName": string,
  "homeTitle": string,
  "mainButtonText": string,
  "packageId": string | null,
  "permissions": string[],
  "intentHost": string | null,
  "locales": string[]
}`.trim();
      const sys = wrapSystem(sysBase);

      try {
        const r = await callGroqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          { json: true, temperature: 0 }
        );
        const { text, trace } = unwrap(r);
        _trace = trace || { rawText: text };

        const j = parseJsonSafely(text) as any;
        if (j) {
          appName = j.appName || appName;
          homeTitle = j.homeTitle || homeTitle;
          mainButtonText = j.mainButtonText || mainButtonText;
          packageId = ensurePackageId(j.packageId || packageId, packageId);
          if (Array.isArray(j.permissions)) permissions = j.permissions;
          if (typeof j.intentHost === "string" || j.intentHost === null)
            intentHost = j.intentHost;
          if (Array.isArray(j.locales) && j.locales.length)
            locales = normalizeLocales(j.locales);
        }
      } catch {
        /* keep defaults */
      }
    } else if (mode === "B" && allowCompanions) {
      const sysBase = `
你是移动端生成助手。以严格 JSON 返回（不可包含代码块标记）：
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
}`.trim();
      const sys = wrapSystem(sysBase);

      try {
        const r = await callGroqChat(
          [
            { role: "system", content: sys },
            { role: "user", content: input.requirement! },
          ],
          { json: true, temperature: 0.3 }
        );
        const { text, trace } = unwrap(r);
        _trace = trace || { rawText: text };

        const j = parseJsonSafely(text) as any;
        if (j) {
          const f = j.fields || {};
          appName = f.appName || appName;
          homeTitle = f.homeTitle || homeTitle;
          mainButtonText = f.mainButtonText || mainButtonText;
          packageId = ensurePackageId(f.packageId || packageId, packageId);

          if (Array.isArray(f.permissions)) permissions = f.permissions;
          if (typeof f.intentHost === "string" || f.intentHost === null)
            intentHost = f.intentHost;
          if (Array.isArray(f.locales) && f.locales.length)
            locales = normalizeLocales(f.locales);

          const comp = Array.isArray(j.companions) ? (j.companions as Companion[]) : [];
          companions = sanitizeCompanions(comp);
        }
      } catch {
        /* swallow */
      }
    }
  }

  // 组装块锚点需要的 XML 片段
  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;

  // 衍生：resConfigs 优先入参，否则由 locales 推导
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 输出（供 generator 使用）
  const out: OrchestrateOutput = {
    template: templateKey as any,
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
