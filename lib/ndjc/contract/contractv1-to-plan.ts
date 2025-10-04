// lib/ndjc/contract/contractv1-to-plan.ts

/* =========================================================
 * Contract v1  → Build Plan（兼容垫片 · 零依赖版）
 * - 去掉了对 "type-fest" 的依赖，内联 JSON 类型
 * - 返回值带上 .meta 以兼容调用方 route.ts 的读取
 * - 函数导出同时提供多个别名，降低对既有调用的侵入
 * =======================================================*/

/** 轻量 JSON 类型（替代 type-fest 的 JSONValue） */
type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | { [k: string]: JSONValue } | JSONValue[];

/** v1 文档的最小结构 */
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
    list?: Record<string, JSONValue | JSONValue[]>;
    if?: Record<string, boolean>;
    res?: Record<string, JSONValue>;
    hook?: Record<string, JSONValue>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };
  patches?: {
    gradle?: Partial<{
      applicationId: string;
      resConfigs: string[];
      permissions: string[];
    }>;
    manifest?: Record<string, unknown>;
  };
  files?: Array<{
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    kind?: "kotlin" | "xml" | "json" | "md" | "txt";
    overwrite?: boolean;
  }>;
  resources?: Record<string, unknown>;
};

/** 规范化前缀：把 key 变成 NDJC:/BLOCK:/LIST:/IF:/HOOK: */
function withPrefix(key: string, kind: "NDJC" | "BLOCK" | "LIST" | "IF" | "HOOK") {
  const k = String(key || "").trim();
  if (!k) return "";
  if (
    k.startsWith("NDJC:") ||
    k.startsWith("BLOCK:") ||
    k.startsWith("LIST:") ||
    k.startsWith("IF:") ||
    k.startsWith("HOOK:")
  ) {
    return k;
  }
  // 允许简写（如 PACKAGE_NAME、ROUTES）
  if (kind === "NDJC") return `NDJC:${k}`;
  return `${kind}:${k}`;
}

/** 把任意 JSONValue 安全地转为字符串（锚点文本替换场景） */
function toStr(v: JSONValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** 把 list 的值统一转成 string[] */
function toStrArr(v: JSONValue | JSONValue[] | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => toStr(x as JSONValue)).filter(Boolean);
  // 允许 v1 把单值放进来
  return [toStr(v as JSONValue)].filter(Boolean);
}

/** 主函数：v1 → plan
 * 返回 any 用于兼容调用方在类型上读取 .meta 字段
 */
export function contractV1ToPlan(v1Raw: unknown, defaultTemplate = "circle-basic"): any {
  const v1 = (v1Raw || {}) as V1Doc;

  const meta = v1.metadata || {};
  const anchors = v1.anchors || {};
  const patches = v1.patches || {};

  const templateKey = meta.template || defaultTemplate;

  // ====== 基本骨架 ======
  const plan: any = {
    template_key: templateKey,
    // 文本锚点
    anchors: {} as Record<string, string>,
    // 块锚点
    blocks: {} as Record<string, string>,
    // 列表锚点
    lists: {} as Record<string, string[]>,
    // 条件锚点
    conditions: {} as Record<string, boolean>,
    // 资源锚点（透传，落盘逻辑在 generator 侧）
    resources: v1.resources || {},
    // HOOK（作为“特殊块”或占位点插入的代码片段）
    hooks: {} as Record<string, string>,
    // v1 files → companions（伴生文件）
    companions: [] as Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>,
    // gradle 附带信息（供 generator 在 build.gradle / manifest 等结构化处理）
    gradle: {
      applicationId: anchors.gradle?.applicationId ?? meta.packageId ?? "",
      resConfigs: (anchors.gradle?.resConfigs ??
        patches.gradle?.resConfigs ??
        []) as string[],
      permissions: (anchors.gradle?.permissions ??
        patches.gradle?.permissions ??
        []) as string[],
    },
    // 兼容调用方读取
    meta,
  };

  // ====== 文本锚点（NDJC:*）======
  for (const [k, v] of Object.entries(anchors.text || {})) {
    const key = withPrefix(k, "NDJC");
    if (key) plan.anchors[key] = toStr(v as JSONValue);
  }

  // 常见兜底：如果文本锚点未提供而 metadata 有，就补上
  if (!plan.anchors["NDJC:PACKAGE_NAME"] && meta.packageId) {
    plan.anchors["NDJC:PACKAGE_NAME"] = meta.packageId;
  }
  if (!plan.anchors["NDJC:APP_LABEL"] && meta.appName) {
    plan.anchors["NDJC:APP_LABEL"] = meta.appName;
  }
  if (!plan.anchors["NDJC:HOME_TITLE"] && meta.appName) {
    plan.anchors["NDJC:HOME_TITLE"] = meta.appName;
  }
  if (!plan.anchors["NDJC:PRIMARY_BUTTON_TEXT"]) {
    plan.anchors["NDJC:PRIMARY_BUTTON_TEXT"] = "Start";
  }

  // ====== 块锚点（BLOCK:* / NDJC:BLOCK:*）======
  for (const [k, v] of Object.entries(anchors.block || {})) {
    let key = String(k || "").trim();
    if (!key.startsWith("BLOCK:") && !key.startsWith("NDJC:BLOCK:")) {
      key = withPrefix(key, "BLOCK");
    }
    if (key) plan.blocks[key] = toStr(v as JSONValue);
  }

  // ====== 列表锚点（LIST:*）======
  for (const [k, lv] of Object.entries(anchors.list || {})) {
    const key = withPrefix(k, "LIST");
    if (!key) continue;
    const arr = toStrArr(lv as any);
    if (arr.length) plan.lists[key] = arr;
  }

  // 保底提供路由列表
  if (!plan.lists["LIST:ROUTES"]) {
    plan.lists["LIST:ROUTES"] = ["home"];
  }

  // ====== 条件锚点（IF:*）======
  for (const [k, b] of Object.entries(anchors.if || {})) {
    const key = withPrefix(k, "IF");
    plan.conditions[key] = !!b;
  }

  // ====== HOOK（HOOK:*）======
  for (const [k, v] of Object.entries(anchors.hook || {})) {
    const key = withPrefix(k, "HOOK");
    if (key) plan.hooks[key] = toStr(v as JSONValue);
  }

  // ====== 伴生文件（files → companions）======
  const files = Array.isArray(v1.files) ? v1.files : [];
  plan.companions = files
    .map((f) => ({
      path: String(f.path || ""),
      content: String(f.content || ""),
      encoding: f.encoding === "base64" ? "base64" : "utf8",
    }))
    .filter((f) => f.path && f.content);

  // ====== gradle 兜底 ======
  if (!plan.gradle.applicationId && plan.anchors["NDJC:PACKAGE_NAME"]) {
    plan.gradle.applicationId = plan.anchors["NDJC:PACKAGE_NAME"];
  }

  return plan;
}

/* 兼容性导出：尽量覆盖现有调用方的不同命名 */
export const convertContractV1ToPlan = contractV1ToPlan;
export const toPlanFromContractV1 = contractV1ToPlan;
export default contractV1ToPlan;
