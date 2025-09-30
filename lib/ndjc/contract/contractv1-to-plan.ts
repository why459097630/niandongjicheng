// lib/ndjc/contract/contractv1-to-plan.ts
import type { ContractV1 } from "./types";

/** generator 期望的 plan 形状（与 buildPlan(o) / applyPlanDetailed 对齐，并扩展 resources/hooks） */
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
  /** 列表锚点（复数）：LIST:* */
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

/* ───────────────────────────── 归一化工具 ───────────────────────────── */

type Dict<T = any> = Record<string, T>;

function toBool(v: any) {
  return v === true || v === "true" || v === 1 || v === "1";
}
function toArrayOfString(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      // 支持 LLM 给的 '["a","b"]' 字符串
      const j = JSON.parse(v);
      if (Array.isArray(j)) return j.map(String);
    } catch {}
    // 逗号 / 换行切分
    return v
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
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

  // 如果是 RES 路径形态，把 "res:" / "res." / "resources:" 归一为 RES:
  if (!/^NDJC:|^BLOCK:|^LIST:|^IF:|^RES:|^HOOK:/i.test(k)) {
    // e.g. "routes" / "route" -> LIST:ROUTES
    if (k.toLowerCase() === "routes" || k.toLowerCase() === "route") return "LIST:ROUTES";
    // e.g. "permissions" -> IF:* 无法自动推断，保持原样
  }

  // 资源别名：res.drawable/... -> RES:drawable/...
  if (/^(res(\.|:)|resources:)/i.test(k)) {
    k = k.replace(/^res(\.|:)/i, "RES:").replace(/^resources:/i, "RES:");
    return k.replace(/\\/g, "/"); // windows 路径转 /
  }

  // HOOK 别名：hook.xxx -> HOOK:XXX
  if (/^hook(\.|:)/i.test(k)) {
    k = k.replace(/^hook(\.|:)/i, "HOOK:");
    return "HOOK:" + k.slice("HOOK:".length).toUpperCase().replace(/\s+/g, "_");
  }

  // 通用前缀
  if (prefix && !new RegExp(`^${prefix}:`, "i").test(k)) {
    k = `${prefix}:${k}`;
  }

  // 大写：只处理 NDJC / BLOCK / LIST / IF，RES 和路径大小写敏感，保持尾部大小写
  if (/^(NDJC|BLOCK|LIST|IF):/i.test(k)) {
    const [p, rest] = k.split(":");
    return p.toUpperCase() + ":" + rest.toUpperCase().replace(/\s+/g, "_");
  }

  // 其他保留原样（如 RES:drawable/...）
  return k;
}

/** 把 Record 归一化成指定前缀（如 NDJC/BLOCK/LIST/IF/RES/HOOK） */
function normalizeRecord(rec: Dict<any> | undefined, kind: "ndjc" | "block" | "list" | "if" | "res" | "hook"): Dict<any> {
  const out: Dict<any> = {};
  if (!rec) return out;

  const PREFIX =
    kind === "ndjc" ? "NDJC" : kind === "block" ? "BLOCK" : kind === "list" ? "LIST" : kind === "if" ? "IF" : kind === "res" ? "RES" : "HOOK";

  for (const [k, v] of Object.entries(rec)) {
    const ck = canonKey(k, PREFIX);
    if (!ck) continue;
    out[ck] = v;
  }
  return out;
}

/* ───────────────────────────── 锚点别名表 ───────────────────────────── */

/** 列表类常见别名 */
const LIST_CANON: Record<string, string> = {
  "LIST:ROUTE": "LIST:ROUTES",
  "LIST:ROUTES": "LIST:ROUTES",
  ROUTES: "LIST:ROUTES",
  "LIST:POST_FIELDS": "LIST:POST_FIELDS",
  POST_FIELDS: "LIST:POST_FIELDS",
  "LIST:COMMENT_FIELDS": "LIST:COMMENT_FIELDS",
  COMMENT_FIELDS: "LIST:COMMENT_FIELDS",
  "LIST:API_SPLITS": "LIST:API_SPLITS",
  API_SPLITS: "LIST:API_SPLITS",
  "LIST:PLURAL_STRINGS": "LIST:PLURAL_STRINGS",
  PLURAL_STRINGS: "LIST:PLURAL_STRINGS",
  "LIST:COMPONENT_STYLES": "LIST:COMPONENT_STYLES",
  COMPONENT_STYLES: "LIST:COMPONENT_STYLES",
  "LIST:REMOTE_FLAGS": "LIST:REMOTE_FLAGS",
  REMOTE_FLAGS: "LIST:REMOTE_FLAGS",
  "LIST:DEEPLINK_PATTERNS": "LIST:DEEPLINK_PATTERNS",
  DEEPLINK_PATTERNS: "LIST:DEEPLINK_PATTERNS",
};

/** 路由相关的块别名（有路由时自动补齐这些块） */
// ★ 关键修改：使用宽松索引签名，允许以任意 string 做键，避免 TS 报错
const ROUTE_BLOCKS: Record<string, readonly string[]> = {
  home: ["BLOCK:ROUTE_HOME"],
  detail: ["BLOCK:ROUTE_DETAIL"],
  post: ["BLOCK:ROUTE_POST"],
};

/** 资源类常见别名：统一到 RES: 前缀，尾部保持大小写（文件名大小写敏感） */
function canonResKey(k: string): string {
  // 支持 "drawable/app_icon.png" 这种无前缀
  if (!/^RES:/i.test(k) && /^(drawable|raw|font|mipmap|values|xml)\//i.test(k)) {
    return "RES:" + k.replace(/\\/g, "/");
  }
  return canonKey(k, "RES");
}

/** HOOK 别名：HOOK:BEFORE_BUILD / HOOK:AFTER_BUILD / HOOK:PRE_INJECT / HOOK:POST_INJECT / HOOK:PRE_COMMIT / HOOK:AFTER_INSTALL */
const HOOK_CANON: Record<string, string> = {
  "HOOK:BEFORE_BUILD": "HOOK:BEFORE_BUILD",
  "HOOK:AFTER_BUILD": "HOOK:AFTER_BUILD",
  "HOOK:PRE_INJECT": "HOOK:PRE_INJECT",
  "HOOK:POST_INJECT": "HOOK:POST_INJECT",
  "HOOK:PRE_COMMIT": "HOOK:PRE_COMMIT",
  "HOOK:AFTER_INSTALL": "HOOK:AFTER_INSTALL",
};

/** 功能模块“配方”：启用某模块时应追加的锚点 */
const MODULE_RECIPES: Record<string, { blocks?: string[]; lists?: Record<string, string[]>; res?: Record<string, string> }> = {
  // Feed 列表（首页）
  feed: {
    blocks: ["BLOCK:HOME_HEADER", "BLOCK:HOME_BODY", "BLOCK:HOME_ACTIONS", "BLOCK:ROUTE_HOME"],
    lists: { "LIST:ROUTES": ["home"] },
  },
  // 详情页
  detail: {
    blocks: ["BLOCK:ROUTE_DETAIL"],
    lists: { "LIST:ROUTES": ["detail"] },
  },
  // 发布 Post
  post: {
    blocks: ["BLOCK:ROUTE_POST"],
    lists: { "LIST:ROUTES": ["post"], "LIST:POST_FIELDS": ["title", "content"] },
  },
  // 关键词搜索（示例：可按需扩展具体块）
  search: {
    blocks: [],
  },
  // 评论列表
  comments: {
    blocks: [],
    lists: { "LIST:COMMENT_FIELDS": ["author", "content", "time"] },
  },
  // EmptyState 空状态
  emptystate: {
    blocks: ["BLOCK:EMPTY_STATE"],
  },
  // TopBar 顶栏（示例：可对应主题/样式）
  topbar: {
    blocks: [],
  },
  // 可选增强（举例：配置导航转场）
  enhance: {
    blocks: ["BLOCK:NAV_TRANSITIONS"],
  },
};

/* ───────────────────────────── 主转换 ───────────────────────────── */

export function contractV1ToPlan(doc: ContractV1): NdjcPlanV1 {
  // ★ 关键强化：packageId 兜底，避免后续空值回落到默认模板
  const pkg =
    (doc.metadata.packageId && String(doc.metadata.packageId)) ||
    (doc as any)?.anchors?.gradle?.applicationId ||
    "com.ndjc.app";

  /* 1) Gradle 汇总（兼容 anchors.gradle 与 patches.*） */
  const g = (doc.anchors?.gradle || ({} as any));
  const gradle = {
    applicationId: g.applicationId || pkg,
    resConfigs: toArrayOfString(g.resConfigs || doc.patches?.gradle?.resConfigs),
    permissions: toArrayOfString(g.permissions || (doc as any)?.patches?.manifest?.permissions),
    compileSdk: doc.patches?.gradle?.compileSdk ?? null,
    minSdk: doc.patches?.gradle?.minSdk ?? null,
    targetSdk: doc.patches?.gradle?.targetSdk ?? null,
    dependencies: (doc.patches?.gradle?.dependencies as any) ?? [],
    proguardExtra: toArrayOfString(doc.patches?.gradle?.proguardExtra),
  };

  /* 2) 读取 anchors 四类 + 新增 RES/HOOK 的多源输入 */
  const textIn = shallowClone(doc.anchors?.text);
  const blockIn = shallowClone(doc.anchors?.block);
  const listIn = shallowClone(doc.anchors?.list);
  const ifIn = shallowClone(doc.anchors?.if);
  const resIn = shallowClone((doc as any)?.anchors?.res ?? (doc as any)?.resources);
  const hookIn = shallowClone((doc as any)?.anchors?.hook ?? (doc as any)?.hooks);

  // 归一化 → 标准前缀
  const text = normalizeRecord(textIn, "ndjc") as Dict<string>;
  const block = normalizeRecord(blockIn, "block") as Dict<string>;
  const listsRaw = normalizeRecord(listIn, "list") as Dict<any>;
  const iff = normalizeRecord(ifIn, "if") as Dict<boolean>;
  const resRaw = normalizeRecord(resIn, "res") as Dict<string>;
  const hookRaw = normalizeRecord(hookIn, "hook") as Dict<any>;

  /* 3) 关键文本锚点兜底 */
  if (!text["NDJC:PACKAGE_NAME"]) text["NDJC:PACKAGE_NAME"] = pkg;
  if (!text["NDJC:APP_LABEL"]) text["NDJC:APP_LABEL"] = doc.metadata.appName;
  if (!text["NDJC:HOME_TITLE"] && doc.metadata.appName) {
    text["NDJC:HOME_TITLE"] = doc.metadata.appName;
  }
  if (!text["NDJC:PRIMARY_BUTTON_TEXT"]) {
    text["NDJC:PRIMARY_BUTTON_TEXT"] = "Start";
  }

  /* 4) 列表类规范化（别名映射 + 数组化） */
  const lists: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(listsRaw)) {
    const key = LIST_CANON[k] || canonKey(k, "LIST");
    lists[key] = toArrayOfString(v);
  }

  // 路由：从 doc.routes 或者 anchors -> 统一进 LIST:ROUTES
  const routesIn: string[] = toArrayOfString((doc as any).routes?.items || (doc as any).routes || lists["LIST:ROUTES"]);
  if (routesIn.length) {
    lists["LIST:ROUTES"] = Array.from(new Set([...(lists["LIST:ROUTES"] || []), ...routesIn]));
    // 根据路由自动补齐块（★ 关键修改：宽松索引签名 + 空数组兜底）
    for (const r of routesIn) {
      const name = String(r).toLowerCase();
      const blocks = ROUTE_BLOCKS[name] || [];
      for (const b of blocks) {
        if (!block[b]) block[b] = ""; // 标记存在即可
      }
    }
  }

  /* 5) 资源锚点（RES:*）规范化：支持多源 */
  const resources: Record<string, string> = {};
  // anchors.res / resources
  for (const [rk, rv] of Object.entries(resRaw)) {
    resources[canonResKey(rk)] = String(rv ?? "");
  }
  // doc.resources?.files（若 LLM 以 files 形式给资源）
  if (Array.isArray((doc as any).resources?.files)) {
    for (const f of (doc as any).resources.files) {
      const k = canonResKey((f as any).key || (f as any).path || (f as any).name || "");
      if (!k) continue;
      resources[k] = String((f as any).content ?? "");
    }
  }

  /* 6) HOOK 锚点（HOOK:*）规范化 */
  const hooks: Record<string, string[]> = {};
  for (const [hk, hv] of Object.entries(hookRaw)) {
    const ck = HOOK_CANON[canonKey(hk, "HOOK")] || canonKey(hk, "HOOK");
    hooks[ck] = toArrayOfString(hv);
  }

  /* 7) 功能模块（增量配方） */
  const modsSrc: string[] = toArrayOfString((doc as any).modules) || toArrayOfString((doc as any)?.features?.modules);
  if (modsSrc.length) {
    const norm = modsSrc.map((s) => String(s).toLowerCase().trim());
    for (const mName of norm) {
      const recipe = MODULE_RECIPES[mName];
      if (!recipe) continue;
      // blocks
      for (const b of recipe.blocks || []) {
        if (!block[b]) block[b] = "";
      }
      // lists
      for (const [lk, lv] of Object.entries(recipe.lists || {})) {
        const canonLk = LIST_CANON[lk] || canonKey(lk, "LIST");
        const exist = new Set(lists[canonLk] || []);
        for (const item of lv) exist.add(String(item));
        lists[canonLk] = Array.from(exist);
      }
      // resources
      for (const [rk, rv] of Object.entries(recipe.res || {})) {
        resources[canonResKey(rk)] = rv;
      }
    }
  }

  /* 8) 伴生文件（仅 B 模式） */
  const companions =
    doc.metadata.mode === "B"
      ? (doc.files || [])
          .filter((f: any) => (f as any).kind !== "manifest_patch")
          .map((f: any) => ({
            path: (f as any).path,
            content: (f as any).content,
            encoding: (f as any).encoding || "utf8",
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
