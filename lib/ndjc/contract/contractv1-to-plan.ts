// lib/ndjc/contract/contractv1-to-plan.ts

/**
 * Contract v1 -> BuildPlan 转换器（带 meta 兼容垫片）
 *
 * - 读取 v1 文档（对象或字符串/代码块形式）
 * - 校正/归一化字段
 * - 生成 BuildPlan（materialize 使用的通用计划）
 * - ★ 附带 `meta` 兼容块：{ runId, template, appName, packageId, mode }
 *   这样前端旧逻辑仍可从 plan.meta.* 读取关键信息
 */

import type { JSONValue } from "type-fest";
// 需要 tsconfig.json 启用 `"resolveJsonModule": true`
import REGISTRY from "../anchors/registry.circle-basic.json" assert { type: "json" };

/* -------------------------------------------------------
 * 类型
 * -----------------------------------------------------*/

// v1 文档（最小子集；允许多余字段）
type V1Doc = {
  metadata?: {
    runId?: string;
    template?: string;
    appName?: string;
    packageId?: string;
    mode?: "A" | "B";
  };
  anchors?: {
    text?: Record<string, JSONValue>;
    block?: Record<string, JSONValue>;
    list?: Record<string, JSONValue>;
    if?: Record<string, JSONValue>;
    res?: Record<string, JSONValue>;
    hook?: Record<string, JSONValue>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[] | string;
      permissions?: string[];
    };
  };
  patches?: {
    gradle?: {
      resConfigs?: string[] | string;
      permissions?: string[];
    };
    manifest?: {
      permissions?: string[];
    };
  };
  files?: Array<{
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    kind?: "kotlin" | "xml" | "json" | "md" | "txt";
  }>;
};

// BuildPlan（给 materialize 使用）— 加入 `meta?` 兼容字段
export type BuildPlan = {
  // ★ 兼容旧前端读取
  meta?: {
    runId?: string;
    template?: string;
    appName?: string;
    packageId?: string;
    mode?: "A" | "B";
  };

  run_id?: string;
  template_key: string;

  anchors: Record<string, string>;
  blocks?: Record<string, string>;
  lists?: Record<string, string[]>;
  conditions?: Record<string, boolean>;
  hooks?: Record<string, string>;

  resources?: {
    values?: {
      strings?: Record<string, string>;
      colors?: Record<string, string>;
      dimens?: Record<string, string>;
    };
    // 追加 strings.xml，不覆盖同名
    stringsExtraXml?: Record<string, string>;
    raw?: Record<string, { content: string; encoding?: "utf8" | "base64"; filename?: string }>;
    drawable?: Record<string, { content: string; encoding?: "utf8" | "base64"; ext?: string }>;
  };

  companions?: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>;

  // 透传/可选
  mode?: "A" | "B";
};

/* -------------------------------------------------------
 * 工具
 * -----------------------------------------------------*/

function parseMaybeJson(input: unknown): any | null {
  if (input == null) return null;
  if (typeof input === "object") return input as any;
  const s = String(input);
  const m = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
  const raw = m ? m[1] : s;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toArray<T = string>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x == null || x === "") return [];
  return [x as T];
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "1" || t === "true" || t === "yes";
  }
  if (typeof v === "number") return v !== 0;
  return !!v;
}

function pickStrings(obj?: Record<string, JSONValue>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    out[k] = str(v);
  }
  return out;
}

function pickStringArray(obj?: Record<string, JSONValue>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    out[k] = toArray<string>(v).map(str).filter(Boolean);
  }
  return out;
}

function pickBooleans(obj?: Record<string, JSONValue>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!obj) return out;
  for (const [k, v] of Object.entries(obj)) {
    out[k] = bool(v);
  }
  return out;
}

// 将 registry 中列出的锚点白名单化（避免脏键）
function filterByRegistry<T extends Record<string, any>>(
  bag: T,
  section: "text" | "block" | "list" | "if" | "hook"
): T {
  const allow: Set<string> = new Set(
    Array.isArray((REGISTRY as any)[section]) ? (REGISTRY as any)[section] : []
  );
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(bag || {})) {
    if (allow.size === 0 || allow.has(k)) out[k] = v;
  }
  return out as T;
}

/* -------------------------------------------------------
 * 主转换函数
 * -----------------------------------------------------*/

export function contractV1ToPlan(input: unknown): BuildPlan {
  const doc = (parseMaybeJson(input) || {}) as V1Doc;

  const meta = doc.metadata || {};
  const a = doc.anchors || {};

  // 1) anchors ——— 归一化
  let anchors = pickStrings(a.text);
  anchors = filterByRegistry(anchors, "text");

  // gradle.applicationId 映射到 PACKAGE_NAME（优先）
  const appId =
    a.gradle?.applicationId ||
    doc.metadata?.packageId ||
    anchors["NDJC:PACKAGE_NAME"];
  if (appId) anchors["NDJC:PACKAGE_NAME"] = String(appId);

  // 兜底 HOME/按钮/标题
  if (!anchors["NDJC:APP_LABEL"] && meta.appName)
    anchors["NDJC:APP_LABEL"] = meta.appName;
  if (!anchors["NDJC:HOME_TITLE"] && anchors["NDJC:APP_LABEL"])
    anchors["NDJC:HOME_TITLE"] = anchors["NDJC:APP_LABEL"];
  if (!anchors["NDJC:PRIMARY_BUTTON_TEXT"])
    anchors["NDJC:PRIMARY_BUTTON_TEXT"] = "Start";

  const blocks = filterByRegistry(pickStrings(a.block), "block");
  const listsBase = pickStringArray(a.list);
  const lists = filterByRegistry(listsBase, "list");

  const conditions = filterByRegistry(pickBooleans(a.if), "if");
  const hooks = filterByRegistry(pickStrings(a.hook), "hook");

  // 2) companions
  const companions =
    (doc.files || []).map((f) => ({
      path: f.path,
      content: f.content || "",
      encoding: f.encoding === "base64" ? "base64" : "utf8",
    })) || [];

  // 3) resources（此处保守为空；如需可从 a.res 中转换）
  const resources: BuildPlan["resources"] = {};

  // 4) template / runId / mode
  const templateKey =
    (meta.template as string) ||
    "circle-basic";

  const runId = meta.runId || undefined;
  const mode = (meta.mode as any) === "B" ? "B" : "A";

  // 5) ★ meta 兼容垫片（供前端老代码读取）
  const metaCompat: NonNullable<BuildPlan["meta"]> = {
    runId,
    template: templateKey,
    appName: anchors["NDJC:APP_LABEL"],
    packageId: anchors["NDJC:PACKAGE_NAME"],
    mode,
  };

  // 6) 组装 BuildPlan
  const plan: BuildPlan = {
    meta: metaCompat,            // ★ 兼容
    run_id: runId,
    template_key: templateKey,
    mode,

    anchors,
    blocks,
    lists,
    conditions,
    hooks,

    resources,
    companions,
  };

  return plan;
}

export default contractV1ToPlan;
