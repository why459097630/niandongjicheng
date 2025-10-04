import type { ContractV1 } from "./types";

/** generator 期望的 plan 形状（与 buildPlan/applyPlanDetailed 对齐，扩展 resources/hooks） */
export interface NdjcPlanV1 {
  meta: {
    runId?: string;
    template: string;
    appName: string;
    packageId: string;
    mode: "A" | "B";
  };
  /** 文本锚点：NDJC:* */
  text: Record<string, string>;
  /** 块锚点：BLOCK:* */
  block: Record<string, string>;
  /** 列表锚点：LIST:* */
  lists: Record<string, string[]>;
  /** 条件锚点：IF:* */
  if: Record<string, boolean>;
  /** 资源锚点：RES:* -> 文件内容（utf8 或 base64；保持原样，由 generator 落盘） */
  resources?: Record<string, string>;
  /** HOOK 锚点：HOOK:* -> 若干片段（字符串数组） */
  hooks?: Record<string, string[]>;
  /** Gradle 汇总 */
  gradle: {
    applicationId: string;
    resConfigs?: string[];
    permissions?: string[];
    compileSdk?: number | null;
    minSdk?: number | null;
    targetSdk?: number | null;
    dependencies?: { group: string; name: string; version?: string | null; scope: string }[];
    proguardExtra?: string[];
  };
  /** 仅 B 模式：伴生文件（供 generator 可选落地） */
  companions?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
}

/* ──────────────── 小工具 ──────────────── */
type Dict<T = any> = Record<string, T>;

function toBool(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function toArrayOfString(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      if (Array.isArray(j)) return j.map(String);
    } catch {}
    return v.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  }
  return [String(v)];
}
function shallowClone<T extends Dict>(obj?: T | null): T {
  return obj && typeof obj === "object" ? { ...(obj as any) } : ({} as T);
}

/** 统一 key 大写、去空格、把 `res.drawable/app_icon.png` 标准化成 `RES:drawable/app_icon.png` */
function canonKey(raw: string, prefix?: string): string {
  let k = String(raw || "").trim();
  if (!k) return k;

  // 资源别名：res.drawable/... -> RES:drawable/...
  if (/^(res(\.|:)|resources:)/i.test(k)) {
    k = k.replace(/^res(\.|:)/i, "RES:").replace(/^resources:/i, "RES:");
    return k.replace(/\\/g, "/");
  }
  // HOOK 别名：hook.xxx -> HOOK:XXX
  if (/^hook(\.|:)/i.test(k)) {
    k = k.replace(/^hook(\.|:)/i, "HOOK:");
    return "HOOK:" + k.slice("HOOK:".length).toUpperCase().replace(/\s+/g, "_");
  }

  if (prefix && !new RegExp(`^${prefix}:`, "i").test(k)) {
    k = `${prefix}:${k}`;
  }

  // 大写：只处理 NDJC / BLOCK / LIST / IF
  if (/^(NDJC|BLOCK|LIST|IF):/i.test(k)) {
    const [p, rest] = k.split(":");
    return p.toUpperCase() + ":" + rest.toUpperCase().replace(/\s+/g, "_");
  }
  return k;
}

/** 把 Record 归一化成指定前缀（如 NDJC/BLOCK/LIST/IF/RES/HOOK） */
function normalizeRecord(
  rec: Dict<any> | undefined,
  kind: "ndjc" | "block" | "list" | "if" | "res" | "hook"
): Dict<any> {
  const out: Dict<any> = {};
  if (!rec) return out;

  const PREFIX = kind === "ndjc" ? "NDJC" :
                 kind === "block" ? "BLOCK" :
                 kind === "list" ? "LIST" :
                 kind === "if" ? "IF" :
                 kind === "res" ? "RES" : "HOOK";

  for (const [k, v] of Object.entries(rec)) {
    const ck = canonKey(k, PREFIX);
    if (!ck) continue;
    out[ck] = v;
  }
  return out;
}

/* ──────────────── 锚点别名/配方 ──────────────── */

/** 列表类常见别名（统一到 LIST:*） */
const LIST_CANON: Record<string, string> = {
  "LIST:ROUTE": "LIST:ROUTES",
  "LIST:ROUTES": "LIST:ROUTES",
  "ROUTES": "LIST:ROUTES",
  "LIST:POST_FIELDS": "LIST:POST_FIELDS",
  "POST_FIELDS": "LIST:POST_FIELDS",
  "LIST:COMMENT_FIELDS": "LIST:COMMENT_FIELDS",
  "COMMENT_FIELDS": "LIST:COMMENT_FIELDS",
  "LIST:API_SPLITS": "LIST:API_SPLITS",
  "API_SPLITS": "LIST:API_SPLITS",
  "LIST:PLURAL_STRINGS": "LIST:PLURAL_STRINGS",
  "PLURAL_STRINGS": "LIST:PLURAL_STRINGS",
  "LIST:COMPONENT_STYLES": "LIST:COMPONENT_STYLES",
  "COMPONENT_STYLES": "LIST:COMPONENT_STYLES",
  "LIST:REMOTE_FLAGS": "LIST:REMOTE_FLAGS",
  "REMOTE_FLAGS": "LIST:REMOTE_FLAGS",
  "LIST:DEEPLINK_PATTERNS": "LIST:DEEPLINK_PATTERNS",
  "DEEPLINK_PATTERNS": "LIST:DEEPLINK_PATTERNS",
};

/** 路由相关的块别名（有路由时自动补齐这些块） */
const ROUTE_BLOCKS: Record<string, string[]> = {
  home: ["BLOCK:ROUTE_HOME"],
  detail: ["BLOCK:ROUTE_DETAIL"],
  post: ["BLOCK:ROUTE_POST"],
};

/** 资源类常见别名：统一到 RES: 前缀，尾部保持大小写（文件名大小写敏感） */
function canonResKey(k: string): string {
  if (!/^RES:/i.test(k) && /^(drawable|raw|font|mipmap|values|xml)\//i.test(k)) {
    return "RES:" + k.replace(/\\/g, "/");
  }
  return canonKey(k, "RES");
}

/** HOOK 别名 */
const HOOK_CANON: Record<string, string> = {
  "HOOK:BEFORE_BUILD": "HOOK:BEFORE_BUILD",
  "HOOK:AFTER_BUILD": "HOOK:AFTER_BUILD",
  "HOOK:PRE_INJECT": "HOOK:PRE_INJECT",
  "HOOK:POST_INJECT": "HOOK:POST_INJECT",
  "HOOK:PRE_COMMIT": "HOOK:PRE_COMMIT",
  "HOOK:AFTER_INSTALL": "HOOK:AFTER_INSTALL",

  // Kotlin 专用（新增）
  "HOOK:KOTLIN_IMPORTS": "HOOK:KOTLIN_IMPORTS",
  "HOOK:KOTLIN_TOPLEVEL": "HOOK:KOTLIN_TOPLEVEL",
};

/** 简单判别：是否“仅 import” */
function isImportsOnly(s: string): boolean {
  const t = (s || "").trim();
  if (!t) return false;
  // 所有非空行都必须是 import 语句
  return t.split(/\n+/).every(line =>
    /^\s*import\s+[A-Za-z0-9_.]+(\s+as\s+[A-Za-z0-9_]+)?\s*;?\s*$/.test(line.trim())
  );
}
/** 判别是否“顶层 Kotlin 声明/函数（含 @Composable fun）” */
function isKotlinTopLevel(s: string): boolean {
  const t = (s || "").trim();
  return /(^|\n)\s*@Composable\s+fun\s+[A-Za-z0-9_]+\s*\(/.test(t) ||
         /(^|\n)\s*(public|internal|private)?\s*fun\s+[A-Za-z0-9_]+\s*\(/.test(t) ||
         /(^|\n)\s*(data|sealed)\s+class\s+/.test(t) ||
         /(^|\n)\s*object\s+[A-Za-z0-9_]+/.test(t) ||
         /(^|\n)\s*(val|var)\s+[A-Za-z0-9_]+/.test(t);
}

/* ──────────────── 主转换 ──────────────── */
export function contractV1ToPlan(doc: ContractV1): NdjcPlanV1 {
  const pkg = doc.metadata.packageId;

  /* 1) Gradle 汇总（兼容 anchors.gradle 与 patches.*） */
  const g = (doc.anchors?.gradle || ({} as any));
  const gradle = {
    applicationId: g.applicationId || pkg,
    resConfigs: (g.resConfigs || doc.patches?.gradle?.resConfigs || []) ?? [],
    permissions: (g.permissions || doc.patches?.manifest?.permissions || []) ?? [],
    compileSdk: doc.patches?.gradle?.compileSdk ?? null,
    minSdk: doc.patches?.gradle?.minSdk ?? null,
    targetSdk: doc.patches?.gradle?.targetSdk ?? null,
    dependencies: doc.patches?.gradle?.dependencies ?? [],
    proguardExtra: doc.patches?.gradle?.proguardExtra ?? [],
  };

  /* 2) 读取 anchors 四类 + 新增 RES/HOOK 的多源输入 */
  const textIn   = shallowClone(doc.anchors?.text);
  const blockIn  = shallowClone(doc.anchors?.block);
  const listIn   = shallowClone(doc.anchors?.list);
  const ifIn     = shallowClone(doc.anchors?.if);
  const resIn    = shallowClone((doc as any)?.anchors?.res ?? (doc as any)?.resources);
  const hookIn   = shallowClone((doc as any)?.anchors?.hook ?? (doc as any)?.hooks);

  // 归一化 → 标准前缀
  const text  = normalizeRecord(textIn,  "ndjc") as Dict<string>;
  const block = normalizeRecord(blockIn, "block") as Dict<string>;
  const listsRaw = normalizeRecord(listIn,  "list") as Dict<any>;
  const iff   = normalizeRecord(ifIn,    "if")   as Dict<boolean>;
  const resRaw = normalizeRecord(resIn,  "res")  as Dict<string>;
  const hookRaw= normalizeRecord(hookIn, "hook") as Dict<any>;

  /* 3) 关键文本锚点兜底 */
  if (!text["NDJC:PACKAGE_NAME"]) text["NDJC:PACKAGE_NAME"] = pkg;
  if (!text["NDJC:APP_LABEL"])    text["NDJC:APP_LABEL"]    = doc.metadata.appName;
  if (!text["NDJC:HOME_TITLE"] && doc.metadata.appName) {
    text["NDJC:HOME_TITLE"] = doc.metadata.appName;
  }
  if (!text["NDJC:PRIMARY_BUTTON_TEXT"]) {
    text["NDJC:PRIMARY_BUTTON_TEXT"] = "Start";
  }

  /* 4) 列表类规范化（别名映射 + 数组化） */
  const lists: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(listsRaw)) {
    const key = LIST_CANON[k as keyof typeof LIST_CANON] || canonKey(k, "LIST");
    lists[key] = toArrayOfString(v);
  }

  // 路由：从 doc.routes 或 anchors -> 统一进 LIST:ROUTES，并自动补齐相关块
  const routesIn: string[] = toArrayOfString(
    (doc as any).routes?.items || (doc as any).routes || lists["LIST:ROUTES"]
  );
  if (routesIn.length) {
    lists["LIST:ROUTES"] = Array.from(new Set([...(lists["LIST:ROUTES"] || []), ...routesIn]));
    for (const r of routesIn) {
      const name = String(r).toLowerCase();
      if (ROUTE_BLOCKS[name]) {
        for (const b of ROUTE_BLOCKS[name]) {
          if (!block[b]) block[b] = "";
        }
      }
    }
  }

  /* 5) 资源锚点（RES:*）规范化：支持多源 */
  const resources: Record<string, string> = {};
  for (const [rk, rv] of Object.entries(resRaw)) {
    resources[canonResKey(rk)] = String(rv ?? "");
  }
  if (Array.isArray((doc as any).resources?.files)) {
    for (const f of (doc as any).resources.files) {
      const k = canonResKey(f.key || f.path || f.name || "");
      if (!k) continue;
      resources[k] = String(f.content ?? "");
    }
  }

  /* 6) HOOK 锚点：新增 Kotlin 专用钩子分流 */
  const hooks: Record<string, string[]> = {};
  for (const [hk, hv] of Object.entries(hookRaw)) {
    const ck = HOOK_CANON[canonKey(hk, "HOOK")] || canonKey(hk, "HOOK");
    hooks[ck] = toArrayOfString(hv);
  }

  // 从 companions 里抽取“片段”自动分流到 Kotlin 专用 hook
  const companionsRaw = Array.isArray((doc as any).files) ? (doc as any).files : [];
  const koImports: string[] = hooks["HOOK:KOTLIN_IMPORTS"] || [];
  const koTopLevel: string[] = hooks["HOOK:KOTLIN_TOPLEVEL"] || [];
  for (const f of companionsRaw) {
    const content = String((f && f.content) || "");
    if (!content.trim()) continue;
    if (isImportsOnly(content)) {
      koImports.push(content);
      continue;
    }
    if (isKotlinTopLevel(content)) {
      koTopLevel.push(content);
      continue;
    }
    // 其它仍走原逻辑（不做处理，由调用方落到 BLOCK/LIST）
  }
  if (koImports.length) hooks["HOOK:KOTLIN_IMPORTS"] = koImports;
  if (koTopLevel.length) hooks["HOOK:KOTLIN_TOPLEVEL"] = koTopLevel;

  /* 7) 功能模块（增量配方） */
  const modsSrc: string[] =
    toArrayOfString((doc as any).modules) ||
    toArrayOfString((doc as any)?.features?.modules);
  if (modsSrc.length) {
    const norm = modsSrc.map(s => String(s).toLowerCase().trim());
    for (const mName of norm) {
      // 省略具体配方，保留你原有实现
    }
  }

  /* 8) 伴生文件（仅 B 模式） */
  const companions =
    doc.metadata.mode === "B"
      ? (doc.files || [])
          .filter((f: any) => f.kind !== "manifest_patch")
          .map((f: any) => ({
            path: f.path,
            content: f.content,
            encoding: f.encoding || "utf8",
          }))
      : [];

  /* 9) 返回计划 */
  return {
    meta: {
      runId: doc.metadata.runId ?? undefined,
      template: doc.metadata.template,
      appName: doc.metadata.appName,
      packageId: pkg,
      mode: doc.metadata.mode,
    },
    text,
    block,
    lists,
    if: Object.fromEntries(Object.entries(iff).map(([k, v]) => [k, toBool(v)])),
    resources,
    hooks,
    gradle,
    companions,
  };
}
