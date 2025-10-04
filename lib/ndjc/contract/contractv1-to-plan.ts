// Contract v1 → Plan（兼容垫片 · 零依赖版）

/** 轻量 JSON 类型 */
type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | { [k: string]: JSONValue } | JSONValue[];

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
    hook?: Record<string, JSONValue>;
    gradle?: {
      applicationId?: string;
      resConfigs?: string[];
      permissions?: string[];
    };
  };
  files?: Array<{ path: string; content: string; encoding?: "utf8" | "base64"; kind?: string }>;
  resources?: Record<string, unknown>;
  patches?: {
    gradle?: Partial<{ applicationId: string; resConfigs: string[]; permissions: string[] }>;
    manifest?: Record<string, unknown>;
  };
};

function withPrefix(key: string, kind: "NDJC" | "BLOCK" | "LIST" | "IF" | "HOOK") {
  const k = String(key || "").trim();
  if (!k) return "";
  if (/^(NDJC|BLOCK|LIST|IF|HOOK):/.test(k)) return k;
  return `${kind}:${k}`;
}
function toStr(v: JSONValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return ""; }
}
function toStrArr(v: JSONValue | JSONValue[] | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => toStr(x as JSONValue)).filter(Boolean);
  return [toStr(v as JSONValue)].filter(Boolean);
}

export function contractV1ToPlan(v1Raw: unknown, defaultTemplate = "circle-basic"): any {
  const v1 = (v1Raw || {}) as V1Doc;
  const meta = v1.metadata || {};
  const a = v1.anchors || {};
  const templateKey = meta.template || defaultTemplate;

  // 顶层扁平结构（供 materialize/generator 使用）
  const plan: any = {
    template_key: templateKey,
    anchors: {} as Record<string, string>,      // NDJC:*
    blocks: {} as Record<string, string>,       // BLOCK:*
    lists: {} as Record<string, string[]>,      // LIST:*
    conditions: {} as Record<string, boolean>,  // IF:*
    hooks: {} as Record<string, string>,        // HOOK:*
    resources: v1.resources || {},
    companions: [] as Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>,
    gradle: {
      applicationId: a.gradle?.applicationId ?? meta.packageId ?? "",
      resConfigs: a.gradle?.resConfigs ?? [],
      permissions: a.gradle?.permissions ?? []
    },
    meta
  };

  // v1 分组也保留一份，便于链路排查（Sanitizer 会做归位）
  const grouped = {
    text: a.text || {},
    block: a.block || {},
    list: a.list || {},
    if: a.if || {},
    hook: a.hook || {},
    gradle: a.gradle || { applicationId: meta.packageId || "" }
  };
  (plan as any).anchorsGrouped = grouped;

  // 扁平化（兜底转换）
  for (const [k, v] of Object.entries(grouped.text)) {
    const key = withPrefix(k, "NDJC");
    if (key) plan.anchors[key] = toStr(v as JSONValue);
  }
  for (const [k, v] of Object.entries(grouped.block)) {
    const key = withPrefix(k, "BLOCK");
    if (key) plan.blocks[key] = toStr(v as JSONValue);
  }
  for (const [k, v] of Object.entries(grouped.list)) {
    const key = withPrefix(k, "LIST");
    if (key) {
      const arr = toStrArr(v as any);
      if (arr.length) plan.lists[key] = arr;
    }
  }
  for (const [k, b] of Object.entries(grouped.if)) {
    const key = withPrefix(k, "IF");
    plan.conditions[key] = !!b;
  }
  for (const [k, v] of Object.entries(grouped.hook)) {
    const key = withPrefix(k, "HOOK");
    if (key) plan.hooks[key] = toStr(v as JSONValue);
  }

  // companions
  const files = Array.isArray(v1.files) ? v1.files : [];
  plan.companions = files
    .map((f) => ({
      path: String(f.path || ""),
      content: String(f.content || ""),
      encoding: f.encoding === "base64" ? "base64" : "utf8"
    }))
    .filter((f) => f.path && f.content);

  // 关键文本锚兜底
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
  if (!plan.lists["LIST:ROUTES"]) {
    plan.lists["LIST:ROUTES"] = ["home"];
  }
  if (!plan.gradle.applicationId && plan.anchors["NDJC:PACKAGE_NAME"]) {
    plan.gradle.applicationId = plan.anchors["NDJC:PACKAGE_NAME"];
  }

  return plan;
}

export const convertContractV1ToPlan = contractV1ToPlan;
export const toPlanFromContractV1 = contractV1ToPlan;
export default contractV1ToPlan;
