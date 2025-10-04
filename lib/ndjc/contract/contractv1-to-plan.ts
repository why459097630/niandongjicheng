// lib/ndjc/contract/contractv1-to-plan.ts
//
// 将 Contract v1 JSON（字符串或对象）转换为通用 BuildPlan，
// 并使用 anchors 注册表做强校验 + 规范化（只通过白名单锚点）。
//
// 依赖：niandongjicheng/lib/ndjc/anchors/registry.circle-basic.json

import type { Buffer } from "node:buffer";

// ---------- 注册表类型与导入 ----------
interface AnchorRegistry {
  text: string[];               // NDJC:* 锚点（不含前缀也可，但推荐带前缀）
  block: string[];              // BLOCK:*
  list: string[];               // LIST:*
  if: string[];                 // IF:*
  hooks?: string[];             // HOOK:*
  resources?: {
    drawable?: string[];        // e.g. RES:drawable/app_icon.png
    raw?: string[];             // e.g. RES:raw/theme_colors.json
    values?: {
      strings?: string[];
      colors?: string[];
      dimens?: string[];
    };
  };
}

// 重要：用强类型断言为 AnchorRegistry，避免 “unknown” 报错
import registryJson from "../anchors/registry.circle-basic.json";
const REGISTRY: AnchorRegistry = registryJson as AnchorRegistry;

// ---------- 外部类型（与 generator.ts 对齐的子集） ----------
export type BuildPlan = {
  run_id?: string;
  template_key: string;
  preset_used?: string;

  anchors: Record<string, any>;
  conditions?: Record<string, boolean>;
  lists?: Record<string, any[]>;
  blocks?: Record<string, string>;
  hooks?: Record<string, string>;
  resources?: {
    values?: {
      strings?: Record<string, string>;
      colors?: Record<string, string>;
      dimens?: Record<string, string>;
    };
    raw?: Record<string, { content: string; encoding?: "utf8" | "base64"; filename?: string }>;
    drawable?: Record<string, { content: string; encoding?: "utf8" | "base64"; ext?: string }>;
    stringsExtraXml?: Record<string, string>;
  };
  features?: Record<string, any>;
  routes?: Array<string | { path: string; name?: string; icon?: string }>;
  companions?: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>;
};

// v1 文档（最小子集，兼容 orchestrator.makeV1Doc 的输出）
type ContractV1 = {
  metadata?: {
    runId?: string;
    template?: string;
    appName?: string;
    packageId?: string;
    mode?: "A" | "B";
  };
  anchors?: {
    text?: Record<string, any>;
    block?: Record<string, string>;
    list?: Record<string, any[]>;
    if?: Record<string, boolean>;
    res?: any;
    hook?: Record<string, string>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];    // 仅记录，不在此处强注入
      permissions?: string[];   // 仅记录（manifest 注入在 materialize）
    };
  };
  patches?: {
    gradle?: any;
    manifest?: any;
  };
  files?: Array<{ path: string; content: string; encoding?: "utf8" | "base64"; kind?: string }>;
  resources?: any; // 兼容字段；实际按 BuildPlan.resources 分配
};

// ---------- 工具 ----------
const upper = (s: string) => String(s || "").toUpperCase().trim();
const trim = (s: string) => String(s || "").trim();

function withPrefix(key: string, pref: "NDJC" | "BLOCK" | "LIST" | "IF" | "HOOK") {
  const k = trim(key);
  if (k.includes(":")) return k;
  return `${pref}:${k}`;
}
function normKey(key: string) {
  // 统一大小写，但不动 value；对 KEY 自身做上档与多余空白修整
  // 注意：返回 *原样前缀 + 大写主体*（便于与注册表对比）
  const i = key.indexOf(":");
  if (i < 0) return upper(key);
  const pref = key.slice(0, i);
  const body = key.slice(i + 1);
  return `${upper(pref)}:${upper(body)}`;
}

function toSet(arr?: string[]) {
  const s = new Set<string>();
  (arr || []).forEach((k) => s.add(normKey(k)));
  return s;
}

// 注册表 → 白名单集合
const TEXT_ALLOW = toSet(REGISTRY.text);
const BLOCK_ALLOW = toSet(REGISTRY.block);
const LIST_ALLOW = toSet(REGISTRY.list);
const IF_ALLOW = toSet(REGISTRY.if);
const HOOK_ALLOW = toSet(REGISTRY.hooks || []);

// 生成 *去前缀* 的别名匹配表：
// e.g. 允许 "APP_LABEL" 命中 "NDJC:APP_LABEL"；"ROUTE_HOME" 命中 "BLOCK:ROUTE_HOME"
function aliasMap(set: Set<string>) {
  const m = new Map<string, string>();
  set.forEach((full) => {
    const i = full.indexOf(":");
    const body = i >= 0 ? full.slice(i + 1) : full;
    m.set(upper(body), full);
  });
  return m;
}
const TEXT_ALIAS = aliasMap(TEXT_ALLOW);
const BLOCK_ALIAS = aliasMap(BLOCK_ALLOW);
const LIST_ALIAS = aliasMap(LIST_ALLOW);
const IF_ALIAS = aliasMap(IF_ALLOW);
const HOOK_ALIAS = aliasMap(HOOK_ALLOW);

function canonKey(raw: string, kind?: "TEXT" | "BLOCK" | "LIST" | "IF" | "HOOK"): string | null {
  const k = normKey(raw);
  const [pref, body] = k.includes(":") ? [k.split(":")[0], k.split(":").slice(1).join(":")] : [k, ""];
  const bodyKey = upper(body);

  const tryAlias = (alias: Map<string, string>, allow: Set<string>, wantPref: string) => {
    // 已有前缀且在 allow 里，直过
    if (allow.has(k)) return k;
    // 无法直接通过时，尝试用 body 别名映射
    const mapped = alias.get(bodyKey);
    if (!mapped) return null;
    // 若指定 kind，需校验 mapped 前缀匹配
    if (kind && !mapped.startsWith(`${kind}:`) && !(kind === "TEXT" && mapped.startsWith("NDJC:"))) {
      // TEXT 特判 -> NDJC:
      return null;
    }
    return mapped;
  };

  switch (kind || (pref as any)) {
    case "TEXT":
    case "NDJC":
      return tryAlias(TEXT_ALIAS, TEXT_ALLOW, "NDJC");
    case "BLOCK":
      return tryAlias(BLOCK_ALIAS, BLOCK_ALLOW, "BLOCK");
    case "LIST":
      return tryAlias(LIST_ALIAS, LIST_ALLOW, "LIST");
    case "IF":
      return tryAlias(IF_ALIAS, IF_ALLOW, "IF");
    case "HOOK":
      return tryAlias(HOOK_ALIAS, HOOK_ALLOW, "HOOK");
    default: {
      // 未显式给 kind：根据前缀猜
      if (pref === "NDJC") return tryAlias(TEXT_ALIAS, TEXT_ALLOW, "NDJC");
      if (pref === "BLOCK") return tryAlias(BLOCK_ALIAS, BLOCK_ALLOW, "BLOCK");
      if (pref === "LIST") return tryAlias(LIST_ALIAS, LIST_ALLOW, "LIST");
      if (pref === "IF") return tryAlias(IF_ALIAS, IF_ALLOW, "IF");
      if (pref === "HOOK") return tryAlias(HOOK_ALIAS, HOOK_ALLOW, "HOOK");
      // 没有前缀时，优先当作 TEXT
      return tryAlias(TEXT_ALIAS, TEXT_ALLOW, "NDJC");
    }
  }
}

// ---------- 主转换 ----------
export function contractV1ToPlan(input: string | ContractV1): BuildPlan {
  const doc: ContractV1 =
    typeof input === "string" ? safeParseJson(input) : (input || ({} as any));

  const meta = doc.metadata || {};
  const a = doc.anchors || {};
  const templateKey = trim(meta.template || "circle-basic");

  const anchors: Record<string, any> = {};
  const blocks: Record<string, string> = {};
  const lists: Record<string, any[]> = {};
  const ifs: Record<string, boolean> = {};
  const hooks: Record<string, string> = {};

  // 1) TEXT
  for (const [k, v] of Object.entries(a.text || {})) {
    const c = canonKey(k, "TEXT");
    if (c) anchors[c] = v;
  }

  // 2) BLOCK
  for (const [k, v] of Object.entries(a.block || {})) {
    const c = canonKey(k, "BLOCK");
    if (c) blocks[c] = String(v ?? "");
  }

  // 3) LIST
  for (const [lk, lv] of Object.entries(a.list || {})) {
    const c = canonKey(lk, "LIST");
    if (!c) continue;
    const exist = new Set<string>((lists[c] as any[]) || []);
    // lv 在旧代码里因 JSON import 类型不明而被推断为 unknown，这里显式断言 string[]
    for (const item of (lv as any[])) exist.add(String(item));
    lists[c] = Array.from(exist);
  }

  // 4) IF
  for (const [k, v] of Object.entries(a.if || {})) {
    const c = canonKey(k, "IF");
    if (!c) continue;
    ifs[c] = !!v;
  }

  // 5) HOOK
  for (const [k, v] of Object.entries(a.hook || {})) {
    const c = canonKey(k, "HOOK");
    if (!c) continue;
    hooks[c] = String(v ?? "");
  }

  // 6) 伴生文件（files -> companions）
  const companions = (doc.files || []).map((f) => ({
    path: String(f.path || ""),
    content: String(f.content || ""),
    encoding: (f.encoding === "base64" ? "base64" : "utf8") as "utf8" | "base64",
  }));

  // 7) 资源映射（可选；此处仅做透明传递，实际落地在 generator.ts）
  const resources = normalizeResources(doc.resources);

  // 8) 条件/Gradle 补充：applicationId -> NDJC:PACKAGE_NAME（兜底，不覆盖 text 显式值）
  const appId = a.gradle?.applicationId || meta.packageId;
  if (appId && anchors["NDJC:PACKAGE_NAME"] == null) {
    anchors["NDJC:PACKAGE_NAME"] = appId;
  }
  // routes 兜底 -> LIST:ROUTES
  if (!lists["LIST:ROUTES"]) lists["LIST:ROUTES"] = ["home"];

  const plan: BuildPlan = {
    run_id: meta.runId,
    template_key: templateKey,
    anchors,
    blocks,
    lists,
    conditions: ifs,
    hooks,
    resources,
    companions,
  };

  return plan;
}

// ---------- 工具：资源归一 ----------
function normalizeResources(src: any): BuildPlan["resources"] | undefined {
  if (!src || typeof src !== "object") return undefined;
  const out: BuildPlan["resources"] = {};
  const values = src.values || {};
  const raw = src.raw || {};
  const draw = src.drawable || {};

  if (Object.keys(values).length) {
    out.values = {};
    if (values.strings) out.values.strings = { ...values.strings };
    if (values.colors) out.values.colors = { ...values.colors };
    if (values.dimens) out.values.dimens = { ...values.dimens };
  }
  if (Object.keys(raw).length) {
    out.raw = {};
    for (const [k, v] of Object.entries<any>(raw)) {
      out.raw[k] = {
        content: String(v?.content || ""),
        encoding: v?.encoding === "base64" ? "base64" : "utf8",
        filename: v?.filename ? String(v.filename) : undefined,
      };
    }
  }
  if (Object.keys(draw).length) {
    out.drawable = {};
    for (const [k, v] of Object.entries<any>(draw)) {
      out.drawable[k] = {
        content: String(v?.content || ""),
        encoding: v?.encoding === "base64" ? "base64" : "utf8",
        ext: v?.ext ? String(v.ext) : undefined,
      };
    }
  }
  return out;
}

// ---------- 工具：安全 JSON 解析 ----------
function safeParseJson(text: string): ContractV1 {
  try {
    // 兼容 ```json ... ``` 包裹
    const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
    const raw = m ? m[1] : text;
    return JSON.parse(raw);
  } catch {
    return {} as ContractV1;
  }
}

export default contractV1ToPlan;
