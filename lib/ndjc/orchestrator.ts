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
  aliases?: Record<string, string>; // 形如 "NDJC:MAIN_BUTTON" → "TEXT:NDJC:PRIMARY_BUTTON_TEXT"
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
  // 注册表中的非 TEXT 键在文件里是“去前缀”的；对 LLM，我们展示“带前缀”的完整白名单，禁止输出别名。
  const allowText = reg.text; // TEXT 锚点本身就是完整键（NDJC:...）
  const allowBlock = withPrefix("BLOCK", reg.block);
  const allowList = withPrefix("LIST", reg.list);
  const allowIf = withPrefix("IF", reg.if);
  const allowHook = withPrefix("HOOK", reg.hook);

  const lines: string[] = [];
  lines.push(`你是“念动即成 NDJC”的模板生成助手。**只输出严格 JSON**（不要 Markdown 代码块）。`);
  lines.push(`模板：${reg.template}`);
  lines.push(`只允许使用以下“规范锚点键名”（canonical keys）：`);
  lines.push(`- Text: ${allowText.join(", ")}`);
  lines.push(`- Block: ${allowBlock.join(", ")}`);
  lines.push(`- List: ${allowList.join(", ")}`);
  lines.push(`- If: ${allowIf.join(", ")}`);
  lines.push(`- Hook: ${allowHook.join(", ")}`);
  if (reg.resources?.length) lines.push(`- Resources: ${reg.resources.join(", ")}`);
  lines.push(`禁止使用别名或未列出的键名。即使你知道某些别名，也必须将其映射为上面列出的规范键名，仅输出规范键名。`);
  lines.push(`请返回 **Contract v1** 文档，且 **metadata.mode 固定为 "B"**。结构示例如下（仅示例，注意采用上面的允许清单）：`);
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
  "files": []
}`);
  lines.push(`要求：
1) 只能使用上面列出的规范键名，严禁输出别名或未知键。
2) 缺省项请给空对象 {} 或空数组 []，不要发明新键。
3) 输出必须是可被 JSON.parse 解析的纯 JSON 文本。`);
  return lines.join("\n");
}

/* ----------------- alias & prefix normalization ----------------- */

// 将别名映射到规范键；保持前缀完整（TEXT:/BLOCK:/LIST:/IF:/HOOK:）
function normalizeKeyWithAliases(key: string, aliases?: Record<string, string>): string {
  const k = (key || "").trim();
  if (!k) return k;

  // 若 registry.aliases 提供的 value 已含前缀（如 "TEXT:NDJC:APP_LABEL"），直接使用
  const direct = aliases?.[k];
  if (direct) return direct;

  // 对无前缀的情况，尽量补前缀（LLM 偶尔会漏写），仅用于常见类型预测
  if (/^NDJC:/.test(k)) return `TEXT:${k}`;
  if (/^BLOCK:/.test(k) || /^LIST:/.test(k) || /^IF:/.test(k) || /^HOOK:/.test(k)) return k;

  // 简单启发：看关键字
  if (/^ROUTES$|FIELDS$|FLAGS$|STYLES$|PATTERNS$|PROGUARD|SPLITS|STRINGS$/i.test(k)) return `LIST:${k}`;
  if (/^PERMISSION|INTENT|NETWORK|FILE_PROVIDER/i.test(k)) return `IF:${k}`;
  if (/^HOME_|^ROUTE_|^NAV_|^SPLASH_|^EMPTY_|^ERROR_|^DEPENDENCY_|^DEBUG_|^BUILD_|^HEADER_|^PROFILE_|^SETTINGS_/i.test(k)) return `BLOCK:${k}`;

  // 默认不加前缀（未知键让 sanitize 丢弃），或由 TEXT 补救
  return k;
}

// 将 anchors.* 中的键统一为规范形式，并将列表/布尔值等类型做轻量规整
function normalizeAnchorsUsingRegistry(raw: any, reg: Registry) {
  const out: any = { text: {}, block: {}, list: {}, if: {}, hook: {}, gradle: {} };

  const tryAssign = (dict: any, key: string, val: any) => {
    if (key.startsWith("TEXT:")) dict.text[key.replace(/^TEXT:/, "") || key] = val;
    else if (key.startsWith("BLOCK:")) dict.block[key.replace(/^BLOCK:/, "") || key] = val;
    else if (key.startsWith("LIST:")) dict.list[key.replace(/^LIST:/, "") || key] = Array.isArray(val) ? val : (val == null ? [] : [val]);
    else if (key.startsWith("IF:")) dict.if[key.replace(/^IF:/, "") || key] = !!val;
    else if (key.startsWith("HOOK:")) dict.hook[key.replace(/^HOOK:/, "") || key] = Array.isArray(val) ? val.join("\n") : String(val ?? "");
    // 其他：忽略，交由 sanitize/validator 决定
  };

  const from = raw || {};
  const groups = ["text", "block", "list", "if", "hook"];
  for (const g of groups) {
    const m = from[g] || {};
    for (const [k, v] of Object.entries(m)) {
      const key0 = String(k);
      // 如果 LLM 已带前缀，则先用原样；否则用 heuristics；最后用 aliases 覆盖
      let key1 = key0;
      if (!/^(TEXT|BLOCK|LIST|IF|HOOK):/.test(key1)) {
        key1 = normalizeKeyWithAliases(key1, reg.aliases);
      }
      // 别名映射优先（别名→规范）
      const mapped = reg.aliases?.[key1] || reg.aliases?.[key0];
      const key2 = mapped || key1;

      tryAssign(out, key2, v);
    }
  }

  // 一些 LLM 可能把 text 键直接放在 anchors 根上（不规范），尝试识别 NDJC: 开头作为 TEXT
  for (const [k, v] of Object.entries(from)) {
    if (groups.includes(k)) continue;
    if (/^NDJC:/.test(k)) {
      tryAssign(out, `TEXT:${k}`, v);
    }
  }

  // gradle 透传（下游 sanitize 再细化）
  if (from.gradle && typeof from.gradle === "object") {
    out.gradle = { ...from.gradle };
  }

  // 把规范键裁剪到 registry 白名单范围（只保留 canonical）
  const keep = {
    text: new Set(reg.text), // TEXT 键是带 NDJC: 的“完整键”
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

/* ----------------- main orchestrate ----------------- */

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateOutput> {
  const reg = (await loadRegistry()) || {
    template: "circle-basic",
    text: ["NDJC:PACKAGE_NAME", "NDJC:APP_LABEL", "NDJC:HOME_TITLE", "NDJC:PRIMARY_BUTTON_TEXT"],
    block: [],
    list: ["ROUTES"], // 注意：无前缀
    if: [],
    hook: [],
    aliases: {}
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

      // 归一化 anchors（别名→规范、补前缀），并裁剪到 registry 白名单
      const rawAnchors = parsed?.anchors || parsed?.anchorsGrouped || {};
      const normalized = normalizeAnchorsUsingRegistry(rawAnchors, reg);

      _trace = {
        rawText: text,
        registryUsed: true,
        parsedMode: parsed?.metadata?.mode,
        anchorsBefore: rawAnchors,
        anchorsAfter: normalized
      };

      if (parsed?.metadata) {
        appName = parsed.metadata.appName || appName;
        packageId = ensurePackageId(parsed.metadata.packageId || packageId, packageId);
      }

      // 从规范化后的 text 中取关键 UI 文案
      if (normalized?.text) {
        homeTitle = normalized.text["NDJC:HOME_TITLE"] || homeTitle;
        mainButtonText = normalized.text["NDJC:PRIMARY_BUTTON_TEXT"] || mainButtonText;
        appName = normalized.text["NDJC:APP_LABEL"] || appName;
        packageId = ensurePackageId(normalized.text["NDJC:PACKAGE_NAME"] || packageId, packageId);
      }

      // gradle 补充
      if (Array.isArray(normalized?.gradle?.resConfigs)) {
        locales = normalizeLocales(normalized.gradle.resConfigs);
      } else if (Array.isArray(parsed?.anchors?.gradle?.resConfigs)) {
        locales = normalizeLocales(parsed.anchors.gradle.resConfigs);
      }
      if (Array.isArray(parsed?.anchors?.gradle?.permissions)) {
        permissions = parsed.anchors.gradle.permissions;
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

  // 若需强制 v1、但上游没给任何可解析文本，则生成最小 v1 供记录（保持与 registry 一致）
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
