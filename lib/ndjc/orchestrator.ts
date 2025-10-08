import fs from "node:fs/promises";
import path from "node:path";
import { groqChat as callGroqChat } from "@/lib/ndjc/groq";
import type { NdjcRequest } from "./types";

type Registry = {
  template: string;
  text: string[];
  block: string[];
  list: string[];
  if: string[];
  hook: string[];
  resources?: string[];
  aliases?: Record<string, string>;
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
  const hint =
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

function buildSystemPromptFromRegistry(reg: Registry): string {
  // 注册表里非 TEXT 键是“去前缀”的；提示里展示为“带前缀”的允许清单，便于 LLM 照着生成。
  const allowText = reg.text;
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList = withPrefix("LIST", reg.list);
  const allowIf = withPrefix("IF", reg.if);
  const allowHook = withPrefix("HOOK", reg.hook);

  const lines: string[] = [];
  lines.push(`你是“念动即成 NDJC”的模板生成助手。**只输出严格 JSON**（不要 Markdown 代码块）。`);
  lines.push(`模板：${reg.template}`);
  lines.push(`只允许使用以下锚点键：`);
  lines.push(`- Text: ${allowText.join(", ")}`);
  lines.push(`- Block: ${allowBlock.join(", ")}`);
  lines.push(`- List: ${allowList.join(", ")}`);
  lines.push(`- If: ${allowIf.join(", ")}`);
  lines.push(`- Hook: ${allowHook.join(", ")}`);
  if (reg.resources?.length) lines.push(`- Resources: ${reg.resources.join(", ")}`);
  lines.push(`请返回 **Contract v1** 文档，且 **metadata.mode 固定为 "B"**。结构示例如下：`);
  lines.push(`{
  "metadata": { "template": "${reg.template}", "appName": "应用名", "packageId": "com.example.app", "mode": "B" },
  "anchors": {
    "text": { "NDJC:PACKAGE_NAME": "com.example.app", "NDJC:APP_LABEL": "示例App", "NDJC:HOME_TITLE": "首页", "NDJC:PRIMARY_BUTTON_TEXT": "开始" },
    "block": { "BLOCK:HOME_HEADER": "<!-- xml or kotlin snippet -->" },
    "list":  { "LIST:ROUTES": ["home"] },
    "if":    { "IF:PERMISSION.NOTIFICATION": true },
    "hook":  { "HOOK:BEFORE_BUILD": "// gradle snippet" },
    "gradle": { "applicationId": "com.example.app", "resConfigs": ["en","zh-rCN"], "permissions": ["android.permission.POST_NOTIFICATIONS"] }
  },
  "files": []  // 若允许伴生文件，可在此给出 [{path,content}]
}`);
  lines.push(`要求：`);
  lines.push(`1) 只能使用上面列出的锚点键（Block/List/If/Hook 键名可带前缀，也可不带，推荐带前缀）。`);
  lines.push(`2) 缺省项请给空对象 {} 或空数组 []，不要发明新键。`);
  lines.push(`3) 输出必须是可被 JSON.parse 解析的纯 JSON 文本。`);
  return lines.join("\n");
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg = (await loadRegistry()) || {
    template: "circle-basic",
    text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
    block: [],
    list: ["ROUTES"], // 注意：无前缀
    if: [],
    hook: []
  };

  let appName = input.appName || "NDJC App";
  let homeTitle = input.homeTitle || "Home";
  let mainButtonText = input.mainButtonText || "Start";
  let packageId = ensurePackageId(input.packageId || input.packageName, "com.ndjc.demo.core");

  let permissions = input.permissions || [];
  let intentHost = input.intentHost ?? null;
  let locales = normalizeLocales(input.locales);

  let companions: Companion[] = Array.isArray(input._companions) ? sanitizeCompanions(input._companions) : [];

  // ❗强制使用 B 模式（防止前端/上游漂移到 A）
  const mode: "A" | "B" = "B";
  const allowCompanions = !!input.allowCompanions && mode === "B";
  const template = (input.template as any) || (reg.template || "circle-basic");

  let _trace: any | null = null;

  if (input.requirement?.trim()) {
    const system = buildSystemPromptFromRegistry(reg);
    try {
      const r = await callGroqChat(
        [
          { role: "system", content: system },
          { role: "user", content: input.requirement! }
        ],
        { json: true, temperature: 0 }
      );
      const text = typeof r === "string" ? r : (r as any)?.text ?? "";
      const parsed = parseJsonSafely(text) as any;
      _trace = { rawText: text, registryUsed: true, parsedMode: parsed?.metadata?.mode };

      // 只做“提要级兜底”，真正的 v1→plan、白名单、前缀归一化由 sanitize/materialize 负责
      if (parsed?.metadata) {
        appName = parsed.metadata.appName || appName;
        packageId = ensurePackageId(parsed.metadata.packageId || packageId, packageId);
      }
      const anchors = parsed?.anchors || parsed?.anchorsGrouped || {};
      if (anchors?.text) {
        homeTitle = anchors.text["NDJC:HOME_TITLE"] || homeTitle;
        mainButtonText = anchors.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;
      }
      if (Array.isArray(anchors?.gradle?.resConfigs)) {
        locales = normalizeLocales(anchors.gradle.resConfigs);
      }
      if (Array.isArray(anchors?.gradle?.permissions)) {
        permissions = anchors.gradle.permissions;
      }
      if (allowCompanions && Array.isArray(parsed?.files)) {
        companions = sanitizeCompanions(parsed.files);
      }

      // 若 LLM 意外返回了非 B，则记录并“显式覆盖为 B”
      if (parsed?.metadata?.mode && String(parsed.metadata.mode).toUpperCase() !== "B") {
        _trace.modeOverriddenToB = true;
      }
    } catch (e: any) {
      _trace = { error: e?.message || String(e), registryUsed: !!reg };
      // 忽略错误，走默认兜底
    }
  }

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 若需强制 v1、但上游没给任何可解析文本，则生成最小 v1 供记录（下游 01_xxx.json 可直接使用）
  if (wantV1(input) && (!_trace || !_trace.rawText)) {
    const v1doc = {
      metadata: {
        runId: (input as any).runId || undefined,
        template,
        appName,
        packageId,
        mode
      },
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
        gradle: { applicationId: packageId, resConfigs: resConfigs.split(",").filter(Boolean), permissions }
      },
      files: allowCompanions ? companions : []
    };
    _trace = { rawText: JSON.stringify(v1doc), registryUsed: !!reg, synthesized: true };
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
    _trace
  };
}
