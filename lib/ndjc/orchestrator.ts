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

function buildSystemPromptFromRegistry(reg: Registry): string {
  const lines: string[] = [];
  lines.push(`你是“念动即成 NDJC”的模板生成助手。只输出严格 JSON（不要 Markdown 代码块）。`);
  lines.push(`模板：${reg.template}`);
  lines.push(`允许的锚点键如下（仅可使用这些键名）：`);
  lines.push(`- Text: ${reg.text.join(", ")}`);
  lines.push(`- Block: ${reg.block.join(", ")}`);
  lines.push(`- List: ${reg.list.join(", ")}`);
  lines.push(`- If: ${reg.if.join(", ")}`);
  lines.push(`- Hook: ${reg.hook.join(", ")}`);
  if (reg.resources?.length) lines.push(`- Resources: ${reg.resources.join(", ")}`);
  lines.push(`请返回 **Contract v1** 文档，键结构如下（示例）：`);
  lines.push(`{
  "metadata": { "template": "${reg.template}", "appName": "...", "packageId": "com.example.app", "mode": "A|B" },
  "anchors": {
    "text": { "NDJC:PACKAGE_NAME": "com.example.app", "NDJC:APP_LABEL": "示例App", "NDJC:HOME_TITLE": "首页", "NDJC:PRIMARY_BUTTON_TEXT": "开始" },
    "block": { "BLOCK:HOME_HEADER": "<!-- xml or kotlin snippet -->" },
    "list":  { "LIST:ROUTES": ["home"] },
    "if":    { "IF:PERMISSION.NOTIFICATION": true },
    "hook":  { "HOOK:BEFORE_BUILD": "// gradle snippet" },
    "gradle": { "applicationId": "com.example.app", "resConfigs": ["en","zh-rCN"], "permissions": ["android.permission.POST_NOTIFICATIONS"] }
  },
  "files": []  // 若 mode=B 且允许伴生文件，可在此给出 path/content
}`);
  lines.push(`只使用上面列出的锚点键；不要发明新键；空的部分可以给空对象/空数组。`);
  return lines.join("\n");
}

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg = (await loadRegistry()) || {
    template: "circle-basic",
    text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
    block: [],
    list: ["LIST:ROUTES"],
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

  const mode: "A" | "B" = input.mode === "B" ? "B" : "A";
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
      _trace = { rawText: text, registryUsed: true };
      const j = parseJsonSafely(text) as any;
      // 若能直接抽关键字段，先兜底一下（真正的 v1→plan 在后续阶段）
      if (j?.metadata) {
        appName = j.metadata.appName || appName;
        packageId = ensurePackageId(j.metadata.packageId || packageId, packageId);
      }
      if (j?.anchors?.text) {
        homeTitle = j.anchors.text["NDJC:HOME_TITLE"] || homeTitle;
        mainButtonText = j.anchors.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;
      }
      if (Array.isArray(j?.anchors?.gradle?.resConfigs)) {
        locales = normalizeLocales(j.anchors.gradle.resConfigs);
      }
      if (Array.isArray(j?.anchors?.gradle?.permissions)) {
        permissions = j.anchors.gradle.permissions;
      }
      if (allowCompanions && Array.isArray(j?.files)) {
        companions = sanitizeCompanions(j.files);
      }
    } catch {
      // ignore, fallback to defaults
    }
  }

  const permissionsXml = mkPermissionsXml(permissions);
  const intentFiltersXml = mkIntentFiltersXml(intentHost);
  const themeOverridesXml = (input as any).themeOverridesXml || undefined;
  const resConfigs = input.resConfigs || localesToResConfigs(locales);
  const proguardExtra = input.proguardExtra;
  const packagingRules = input.packagingRules;

  // 若需强制 v1，在 _trace.rawText 中放入 v1 文档（便于下游写 01_orchestrator.json）
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
    _trace = { rawText: JSON.stringify(v1doc), registryUsed: !!reg };
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
