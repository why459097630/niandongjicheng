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
    [k: string]: unknown;
  };
  // 旧形态（anchors）或编排形态（anchorsGrouped）都允许
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
  anchorsGrouped?: {
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
const KOTLIN_GRADLE_TOKENS =
  /(fun\s+\w+\(|@Composable|Scaffold\(|LazyColumn\(|implementation\(|packagingOptions\s*\{|resConfigs\s*['"]|splits\s*\{|abi\s*\{|proguardFiles|versionCode|applicationId\s*["'])/i;

const PLACEHOLDER_BLACKLIST = new Set([
  "value",
  "item",
  "ready",
  "content ready for rendering...",
  "lorem",
  "tbd",
  "n/a",
  "-"
]);

function isLikelyCodeSnippet(s: string, requireComposable = true): boolean {
  const body = s.trim();
  if (!body) return false;
  if (NON_CODE_LANG_HINT.test(body) && !KOTLIN_GRADLE_TOKENS.test(body)) return false;
  const score =
    (/\n/.test(body) ? 1 : 0) +
    (/[{}();]/.test(body) ? 1 : 0) +
    (KOTLIN_GRADLE_TOKENS.test(body) ? 2 : 0);
  if (score < 2) return false;
  return requireComposable ? /@Composable/.test(body) : true;
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
      .replace(/(^')|('$)/g, "")
      .replace(/(['"])?([a-zA-Z0-9_\-]+)(['"])?:/g, '"$2":')
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

/** 将一般语言码转为 Android resConfigs 形态：zh-cn -> zh-rCN, pt-br -> pt-rBR */
function toAndroidResConfig(code: string): string | null {
  const norm = normalizeLangCode(code);
  if (!norm) return null;
  const [lang, region] = norm.split("-");
  if (!region) return lang;
  return `${lang}-r${region.toUpperCase()}`;
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
    if (/[\s|&;>]/.test(s)) return { ok: true, shape: "shell", value: s };
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
  // 兼容 anchors 与 anchorsGrouped
  const anchorsSource =
    (v1.anchorsGrouped && Object.keys(v1.anchorsGrouped).length ? v1.anchorsGrouped : undefined) ||
    (v1.anchors && Object.keys(v1.anchors).length ? v1.anchors : {}) ||
    {} as NonNullable<V1Doc["anchors"]>;

  const templateKey = meta.template || defaultTemplate;

  // 顶层扁平结构（供 materialize/generator 使用）
  const plan: any = {
    template_key: templateKey,
    anchors: {} as Record<string, string>,      // NDJC:*
    blocks: {} as Record<string, string>,       // BLOCK:* 仅接受 snippet（可编译）或 preset
    lists: {} as Record<string, string[]>,      // LIST:*
    listKinds: {} as Record<string, string>,    // LIST:* → 语义种类（resConfigs/proguard/packaging/deps/other）
    conditions: {} as Record<string, boolean>,  // IF:*
    hooks: {} as Record<string, string>,        // HOOK:* （字符串形态）
    hooksStructured: {} as Record<string, { type: string; value: string }>, // 结构化形态
    resources: v1.resources || {},
    companions: [] as Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>,
    gradle: {
      applicationId: anchorsSource.gradle?.applicationId ?? meta.packageId ?? "",
      resConfigs: Array.isArray(anchorsSource.gradle?.resConfigs) ? anchorsSource.gradle!.resConfigs! : [],
      permissions: Array.isArray(anchorsSource.gradle?.permissions) ? anchorsSource.gradle!.permissions! : []
    },
    meta,
    violations: [] as Array<{ field: string; reason: string; sample?: string }>,
    coercions: [] as Array<{ field: string; from: string; to: string }>,
  };

  // 分组镜像（保留以便上游排查）
  const grouped = {
    text: anchorsSource.text || {},
    block: anchorsSource.block || {},
    list: anchorsSource.list || {},
    if: anchorsSource.if || {},
    hook: anchorsSource.hook || {},
    gradle: anchorsSource.gradle || { applicationId: meta.packageId || "" }
  };
  (plan as any).anchorsGrouped = grouped;

  /** ---------- NDJC 文本（含布尔/数值/JSON纠偏 + 占位符过滤） ---------- */
  for (const [k, v] of Object.entries(grouped.text)) {
    const key = withPrefix(k, "NDJC");
    if (!key) continue;

    // 占位词过滤
    if (typeof v === "string" && PLACEHOLDER_BLACKLIST.has(v.trim().toLowerCase())) {
      plan.violations.push({ field: key, reason: "placeholder_value", sample: v });
      continue;
    }

    // 1) 布尔
    const b = toBooleanStrict(v as JSONValue);
    if (b.ok) {
      plan.anchors[key] = String(b.value);
      if (typeof v !== "boolean") {
        plan.coercions.push({ field: key, from: toStr(v as JSONValue), to: String(b.value) });
      }
      continue;
    }
    // 2) 数值
    const n = toNumberStrict(v as JSONValue);
    if (n.ok) {
      plan.anchors[key] = String(n.value);
      if (typeof v !== "number") {
        plan.coercions.push({ field: key, from: toStr(v as JSONValue), to: String(n.value) });
      }
      continue;
    }
    // 3) JSON 对象（典型：STRINGS_EXTRA/ THEME_COLORS 等）
    if (/NDJC:.*(JSON|EXTRA|MAP|DICT|COLORS)$/i.test(key)) {
      const pj = parseJsonObjectLoose(v as JSONValue);
      if (pj.ok) {
        plan.anchors[key] = JSON.stringify(pj.value);
        plan.coercions.push({ field: key, from: toStr(v as JSONValue), to: "json-object-string" });
        continue;
      }
    }

    // 默认：转字符串
    const sv = toStr(v as JSONValue);
    if (PLACEHOLDER_BLACKLIST.has(sv.trim().toLowerCase())) {
      plan.violations.push({ field: key, reason: "placeholder_value", sample: sv });
      continue;
    }
    plan.anchors[key] = sv;
  }

  /** ---------- BLOCK（Compose snippet 或 preset） ---------- */
  for (const [k, v] of Object.entries(grouped.block)) {
    const key = withPrefix(k, "BLOCK");
    if (!key) continue;

    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, any>;
      const snippet = typeof obj.snippet === "string" ? obj.snippet : "";
      if (snippet && isLikelyCodeSnippet(snippet, true)) {
        plan.blocks[key] = snippet;
        continue;
      }
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
      if (/^preset:[A-Za-z0-9_.-]+$/.test(s)) {
        plan.blocks[key] = s;
        continue;
      }
      if (isLikelyCodeSnippet(s, true)) {
        plan.blocks[key] = s;
        plan.coercions.push({ field: key, from: "string", to: "snippet" });
        continue;
      }
      plan.violations.push({ field: key, reason: "non_code_block_string", sample: s.slice(0, 160) });
      continue;
    }

    plan.violations.push({ field: key, reason: "invalid_block_type", sample: toStr(v as JSONValue).slice(0, 160) });
  }

  /** ---------- LIST（规范化并标注语义种类） ---------- */
  for (const [k, raw] of Object.entries(grouped.list)) {
    const key = withPrefix(k, "LIST");
    if (!key) continue;

    const arr = toStrArr(raw as any);
    if (!arr.length) continue;

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
        const andRes = toAndroidResConfig(s);
        if (andRes) { normalized.push(andRes); continue; }
        plan.violations.push({ field: key, reason: "invalid_lang_code", sample: s });
        continue;
      }

      if (kind === "deps") {
        if (isMavenCoord(s) || isGradleSnippet(s)) { normalized.push(s); continue; }
        plan.violations.push({ field: key, reason: "invalid_dependency_item", sample: s });
        continue;
      }

      if (kind === "proguard") {
        if (/^-(keep|dontwarn)\b/.test(s) || /[\{\}]/.test(s)) { normalized.push(s); continue; }
        plan.violations.push({ field: key, reason: "invalid_proguard_rule", sample: s });
        continue;
      }

      if (kind === "packaging") {
        if (/excludes?\b|merges?\b|pickFirsts?\b/i.test(s)) { normalized.push(s); continue; }
        plan.violations.push({ field: key, reason: "invalid_packaging_rule", sample: s });
        continue;
      }

      normalized.push(s);
    }

    if (normalized.length) {
      plan.lists[key] = Array.from(new Set<string>(normalized));
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

  /** ---------- 关键文本锚兜底/一致性 ---------- */
  // RUNID 一致性：若 text 中出现 NDJC:BUILD_META:RUNID，与 metadata.runId 对齐
  const textRunId = plan.anchors["NDJC:BUILD_META:RUNID"];
  if (textRunId) {
    if (!plan.meta.runId) plan.meta.runId = textRunId;
    if (plan.meta.runId !== textRunId) {
      plan.coercions.push({ field: "metadata.runId", from: String(plan.meta.runId), to: textRunId });
      plan.meta.runId = textRunId;
    }
  } else if (plan.meta.runId) {
    plan.anchors["NDJC:BUILD_META:RUNID"] = String(plan.meta.runId);
  }

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

  // Gradle applicationId 兜底
  if (!plan.gradle.applicationId && plan.anchors["NDJC:PACKAGE_NAME"]) {
    plan.gradle.applicationId = plan.anchors["NDJC:PACKAGE_NAME"];
  }

  // Gradle resConfigs 统一转为 Android 形态（zh-cn -> zh-rCN），并与 LIST:RES_CONFIGS_* 合并去重
  const listRes = Object.entries(plan.lists)
    .filter(([k]) => /LIST:RES_CONFIGS/i.test(k))
    .flatMap(([, vals]) => vals);

  const mergedRes = [...(plan.gradle.resConfigs || []), ...listRes];
  const normalizedRes = Array.from(
    new Set<string>(
      mergedRes
        .map((s: string) => toAndroidResConfig(s))
        .filter((x: string | null): x is string => !!x)
    )
  );
  plan.gradle.resConfigs = normalizedRes;

  // Gradle permissions 去重/规范（显式类型以通过 noImplicitAny）
  if (Array.isArray(plan.gradle.permissions)) {
    const perms = plan.gradle.permissions as string[];
    plan.gradle.permissions = Array.from(
      new Set<string>(
        perms
          .map((p: string) => String(p ?? "").trim())
          .filter((p: string): p is string => /^android\.permission\.[A-Z_]+$/.test(p))
      )
    );
  } else {
    plan.gradle.permissions = [];
  }

  return plan;
}

export const convertContractV1ToPlan = contractV1ToPlan;
export const toPlanFromContractV1 = contractV1ToPlan;
export default contractV1ToPlan;
