// lib/ndjc/orchestrator.ts
// 负责把自然语言/参数编排成结构化字段，并在需要时把
// Contract v1 文档**内嵌**到 _trace.rawText，供下游 route/plan 直接读取。

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

  // 显式启用 v1 文档输出
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

// ----------------- helpers -----------------
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

/** 生成最小 Contract v1 文档，供下游（plan）硬校验与注入 */
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
      res: {},
      hook: {},
      gradle: {
        applicationId: opts.packageId,
        resConfigs: resConfigsArr,
        permissions: opts.permissions || [],
      },
    },
    patches: {
      gradle: {
        resConfigs: resConfigsArr,
        permissions: opts.permissions || [],
      },
      manifest: {
        permissions: opts.permissions || [],
      },
    },
    files,
    resources: {},
  };
}

// ----------------- main orchestrate -----------------
export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
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
  const template = (input.template as any) || "circle-basic";

  let _trace: any | null = null;

  if (input.requirement?.trim()) {
    const wrapSystem = (system: string) => {
      const dev = (input.developerNotes || "").trim();
      return dev ? `${system}\n\n---\n# Developer Notes\n${dev}` : system;
    };
    const unwrap = (r: any) =>
      (typeof r === "string" ? { text: r, trace: null } : { text: r?.text ?? "", trace: r?.trace ?? null });

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
      // 容错：忽略 LLM 失败，沿用默认字段
    }
  }

  // XML 片段（供 materialize 阶段落地）
  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;

  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 若启用 v1：把“可校验”的 v1 JSON 放到 _trace.rawText，供下一步 contractV1→plan 使用
  if (wantV1(input)) {
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
    _trace = { rawText: JSON.stringify(v1doc) };
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
