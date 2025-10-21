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

/** ---------- 形态校正辅助：轻量判断与规范化 ---------- */

const NON_CODE_LANG_HINT = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/; // 中/日/韩字符出现大概率非代码
const KOTLIN_GRADLE_TOKENS = /(fun\s+\w+\(|@Composable|Scaffold\(|LazyColumn\(|implementation\(|packagingOptions\s*\{|resConfigs\s*['"]|splits\s*\{|abi\s*\{|proguardFiles|versionCode|applicationId\s*["'])/i;

function isLikelyCodeSnippet(s: string): boolean {
  const body = s.trim();
  if (!body) return false;
  if (NON_CODE_LANG_HINT.test(body) && !KOTLIN_GRADLE_TOKENS.test(body)) return false;
  // 简单的“像代码”启发式：包含括号/花括号/换行、常见 Kotlin/Gradle 关键词
  const score =
    (/\n/.test(body) ? 1 : 0) +
    (/[{}();]/.test(body) ? 1 : 0) +
    (KOTLIN_GRADLE_TOKENS.test(body) ? 2 : 0);
  return score >= 2;
}

function toBooleanStrict(v: JSONValue): { ok: boolean; value?: boolean } {
  if (typeof v === "boolean") return { ok: true, value: v };
  if (typeof v === "number") return { ok: true, value: v !== 0 };
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(t)) return { ok: true, value: true };
    if (["false", "0", "no", "n", "off"].includes(t)) return { ok: true, value: false };
  }
  return { ok: false };
}

function toNumberStrict(v: JSONValue): { ok: boolean; value?: number } {
  if (typeof v === "number" && Number.isFinite(v)) return { ok: true, value: v };
  if (typeof v === "string") {
    const num = Number(v.trim());
    if (Number.isFinite(num)) return { ok: true, value: num };
  }
  return { ok: false };
}

function parseJsonObjectLoose(v: JSONValue): { ok: boolean; value?: Record<string, unknown> } {
  if (v && typeof v === "object" && !Array.isArray(v)) return { ok: true, value: v as any };
  if (typeof v === "string") {
    const txt = v.trim();
    if (!txt) return { ok: false };
    // 兼容单引号/非严格 JSON
    const normalized = txt
      .replace(/(^')|('$)/g, "") // 去掉首尾单引号
      .replace(/(['"])?([a-zA-Z0-9_\-]+)(['"])?:/g, '"$2":') // 松散键名转双引号
      .replace(/'/g, '"');
    try {
      const obj = JSON.parse(normalized);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return { ok: true, value: obj };
    } catch {}
  }
  return { ok: false };
}

function normalizeLangCode(s: string): string | null {
  const v = s.trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z0-9]{2,})?$/.test(v)) return null; // e.g., en, zh, ja, en-us
  return v;
}

function isMavenCoord(s: string): boolean {
  return /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+:[a-zA-Z0-9+_.-]+$/.test(s.trim());
}

function isGradleSnippet(s: string): boolean {
  const t = s.trim();
  return /^implementation\s*\(|^api\s*\(|^kapt\s*\(|^testImplementation\s*\(/.test(t);
}

function detectHookShape(v: JSONValue):
  | { ok: true; shape: "preset_id"; value: string }
  | { ok: true; shape: "gradle_task"; value: string }
  | { ok: true; shape: "shell"; value: string }
  | { ok: false } {
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return { ok: false };
    if (/^preset:/.test(s)) return { ok: true, shape: "preset_id", value: s.slice(7) };
    if (/^[A-Za-z][\w:.-]*$/.test(s)) return { ok: true, shape: "gradle_task", value: s };
    if (/[\s|&;>]/.test(s)) return { ok: true, shape: "shell", value: s }; // 粗略：含空白/管道/重定向视为 shell
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, any>;
    const type = String(obj.type || "").trim();
    if (type === "preset_id" && typeof obj.id === "string" && obj.id.trim()) {
      return { ok: true, shape: "preset_id", value: obj.id.trim() };
    }
    if (type === "gradle_task" && typeof obj.task === "string" && obj.task.trim()) {
      return { ok: true, shape: "gradle_task", value: obj.task.trim() };
    }
    if (type === "shell" && typeof obj.cmd === "string" && obj.cmd.trim()) {
      return { ok: true, shape: "shell", value: obj.cmd.trim() };
    }
  }
  return { ok: false };
}

/** ---------- 主转换 ---------- */

export function contractV1ToPlan(v1Raw: unknown, defaultTemplate = "circle-basic"): any {
  const v1 = (v1Raw || {}) as V1Doc;
  const meta = v1.metadata || {};
  const a = v1.anchors || {};
  const templateKey = meta.template || defaultTemplate;

  // 顶层扁平结构（供 materialize/generator 使用）
  const plan: any = {
    template_key: templateKey,
    anchors: {} as Record<string, string>,      // NDJC:*
    blocks: {} as Record<string, string>,       // BLOCK:* 仅接受 snippet（可编译）或保留给 generator 的占位
    lists: {} as Record<string, string[]>,      // LIST:*
    listKinds: {} as Record<string, string>,    // LIST:* → 语义种类（resConfigs/proguard/packaging/deps/other）
    conditions: {} as Record<string, boolean>,  // IF:*
    hooks: {} as Record<string, string>,        // HOOK:* （序列化回字符串用于简单落位）
    hooksStructured: {} as Record<string, { type: string; value: string }>, // 结构化形态给后续层用
    resources: v1.resources || {},
    companions: [] as Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>,
    gradle: {
      applicationId: a.gradle?.applicationId ?? meta.packageId ?? "",
      resConfigs: Array.isArray(a.gradle?.resConfigs) ? a.gradle!.resConfigs! : [],
      permissions: Array.isArray(a.gradle?.permissions) ? a.gradle!.permissions! : []
    },
    meta,
    // 新增：校正与违规记录，便于审计
    violations: [] as Array<{ field: string; reason: string; sample?: string }>,
    coercions: [] as Array<{ field: string; from: string; to: string }>,
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

  /** ---------- NDJC 文本（含布尔/数值/JSON纠偏） ---------- */
  for (const [k, v] of Object.entries(grouped.text)) {
    const key = withPrefix(k, "NDJC");
    if (!key) continue;

    // 1) 尝试布尔
    const b = toBooleanStrict(v as JSONValue);
    if (b.ok) {
      plan.anchors[key] = String(b.value);
      plan.coercions.push({ field: key, from: toStr(v as JSONValue), to: String(b.value) });
      continue;
    }
    // 2) 尝试数值
    const n = toNumberStrict(v as JSONValue);
    if (n.ok) {
      plan.anchors[key] = String(n.value);
      plan.coercions.push({ field: key, from: toStr(v as JSONValue), to: String(n.value) });
      continue;
    }
    // 3) 尝试 JSON 对象（典型：STRINGS_EXTRA 等）
    if (/NDJC:.*(JSON|EXTRA|MAP|DICT)$/i.test(key)) {
      const pj = parseJsonObjectLoose(v as JSONValue);
      if (pj.ok) {
        plan.anchors[key] = JSON.stringify(pj.value);
        plan.coercions.push({ field: key, from: toStr(v as JSONValue), to: "json-object-string" });
        continue;
      }
    }

    // 默认：转字符串
    plan.anchors[key] = toStr(v as JSONValue);
  }

  /** ---------- BLOCK（仅接受 snippet 或代码状字符串；文本类直接判违规） ---------- */
  for (const [k, v] of Object.entries(grouped.block)) {
    const key = withPrefix(k, "BLOCK");
    if (!key) continue;

    // 支持两种合规形态：
    //  a) { snippet: "可编译代码", lang?: "kotlin"|"gradle" }
    //  b) 代码状字符串（启发式判断）
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, any>;
      const snippet = typeof obj.snippet === "string" ? obj.snippet : "";
      if (snippet && isLikelyCodeSnippet(snippet)) {
        plan.blocks[key] = snippet;
        continue;
      }
      // preset_id 留给 generator 做白名单映射（这里只记录）
      if (typeof obj.preset_id === "string" && obj.preset_id.trim()) {
        plan.blocks[key] = `preset:${obj.preset_id.trim()}`;
        plan.coercions.push({ field: key, from: "object", to: "preset_id" });
        continue;
      }
      plan.violations.push({ field: key, reason: "unsupported_block_shape", sample: JSON.stringify(obj).slice(0, 200) });
      continue;
    }

    if (typeof v === "string") {
      const s = v.trim();
      if (!s) { plan.violations.push({ field: key, reason: "empty_block" }); continue; }
      // 允许 preset:* 直接通过
      if (/^preset:[A-Za-z0-9_.-]+$/.test(s)) {
        plan.blocks[key] = s;
        continue;
      }
      // 代码状字符串 → 认为是 snippet
      if (isLikelyCodeSnippet(s)) {
        plan.blocks[key] = s;
        plan.coercions.push({ field: key, from: "string", to: "snippet" });
        continue;
      }
      // 非代码的自由文本 → 违规（不要自动降级成 NDJC，避免语义错配）
      plan.violations.push({ field: key, reason: "non_code_block_string", sample: s.slice(0, 120) });
      continue;
    }

    plan.violations.push({ field: key, reason: "invalid_block_type", sample: toStr(v as JSONValue).slice(0, 120) });
  }

  /** ---------- LIST（规范化并标注语义种类，非法项丢弃并记录） ---------- */
  const listEntries = Object.entries(grouped.list);
  for (const [k, raw] of listEntries) {
    const key = withPrefix(k, "LIST");
    if (!key) continue;

    const arr = toStrArr(raw as any);
    if (!arr.length) continue;

    // 识别语义种类，供后续 generator 做 DSL 映射
    let kind: "resConfigs" | "proguard" | "packaging" | "deps" | "other" = "other";
    if (/LIST:RES_CONFIGS/i.test(key)) kind = "resConfigs";
    else if (/LIST:PROGUARD/i.test(key)) kind = "proguard";
    else if (/LIST:PACKAGING/i.test(key)) kind = "packaging";
    else if (/LIST:DEPENDENCY/i.test(key)) kind = "deps";

    const normalized: string[] = [];
    for (const item of arr) {
      const s = item.trim();
      if (!s) continue;

      if (kind === "resConfigs") {
        const lang = normalizeLangCode(s);
        if (lang) { normalized.push(lang); continue; }
        plan.violations.push({ field: key, reason: "invalid_lang_code", sample: s });
        continue;
      }

      if (kind === "deps") {
        if (isMavenCoord(s) || isGradleSnippet(s)) { normalized.push(s); continue; }
        plan.violations.push({ field: key, reason: "invalid_dependency_item", sample: s });
        continue;
      }

      if (kind === "proguard") {
        // 粗略允许以 -keep/-dontwarn 开头或以 '{' '}' 包含的多行片段
        if (/^-(keep|dontwarn)\b/.test(s) || /[\{\}]/.test(s)) { normalized.push(s); continue; }
        plan.violations.push({ field: key, reason: "invalid_proguard_rule", sample: s });
        continue;
      }

      if (kind === "packaging") {
        // 简化：允许 excludes/merges/pickFirsts 关键词
        if (/excludes?\b|merges?\b|pickFirsts?\b/i.test(s)) { normalized.push(s); continue; }
        plan.violations.push({ field: key, reason: "invalid_packaging_rule", sample: s });
        continue;
      }

      // 其它未知列表，收下但记录种类为 other
      normalized.push(s);
    }

    if (normalized.length) {
      plan.lists[key] = Array.from(new Set(normalized)); // 去重
      plan.listKinds[key] = kind;
    }
  }

  /** ---------- IF（布尔） ---------- */
  for (const [k, b] of Object.entries(grouped.if)) {
    const key = withPrefix(k, "IF");
    plan.conditions[key] = !!b;
  }

  /** ---------- HOOK（结构化/白名单化） ---------- */
  for (const [k, v] of Object.entries(grouped.hook)) {
    const key = withPrefix(k, "HOOK");
    if (!key) continue;
    const det = detectHookShape(v as JSONValue);
    if (!det.ok) {
      plan.violations.push({ field: key, reason: "invalid_hook_shape", sample: toStr(v as JSONValue).slice(0, 160) });
      continue;
    }
    plan.hooksStructured[key] = { type: det.shape, value: det.value };
    // 回写到 hooks（字符串形态供简单落位）：preset:id / gradle:task / sh:cmd
    const tag = det.shape === "preset_id" ? "preset" : det.shape === "gradle_task" ? "gradle" : "sh";
    plan.hooks[key] = `${tag}:${det.value}`;
  }

  /** ---------- companions ---------- */
  const files = Array.isArray(v1.files) ? v1.files : [];
  plan.companions = files
    .map((f) => ({
      path: String(f.path || ""),
      content: String(f.content || ""),
      encoding: f.encoding === "base64" ? "base64" : "utf8"
    }))
    .filter((f) => f.path && f.content);

  /** ---------- 关键文本锚兜底 ---------- */
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
    plan.listKinds["LIST:ROUTES"] = "other";
  }
  if (!plan.gradle.applicationId && plan.anchors["NDJC:PACKAGE_NAME"]) {
    plan.gradle.applicationId = plan.anchors["NDJC:PACKAGE_NAME"];
  }

  return plan;
}

export const convertContractV1ToPlan = contractV1ToPlan;
export const toPlanFromContractV1 = contractV1ToPlan;
export default contractV1ToPlan;
