// lib/ndjc/contract/contractv1-to-plan.ts
import type { ContractV1 } from "./types";

/** generator 期望的 plan 形状（与 buildPlan/applyPlanDetailed 对齐，扩展 resources/hooks） */
export interface NdjcPlanV1 {
  meta: {
    runId?: string;
    template: string;
    appName: string;
    packageId: string;
    mode: "A" | "B";
    /** 新增：注册表追踪 */
    templateKey?: string;
    registryVersion?: string;
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

/* ──────────────── 注册表加载（极简版） ──────────────── */

type AnchorRegistry = {
  version?: string;
  templateKey?: string;
  textAnchors?: Array<{ key: string; targets?: { strings?: string[] } }>;
  blockAnchors?: string[];
  listAnchors?: string[];
  ifAnchors?: string[];
  hookAnchors?: string[];
  resourceAnchors?: string[];
  aliases?: Record<string, string>;
};

function loadRegistry(): AnchorRegistry {
  // 运行环境可能是 ts-node/tsc 编译后；这里用 require 避免 ESM 限制
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reg = require("../anchors/registry.circle-basic.json");
    return reg as AnchorRegistry;
  } catch {
    return {};
  }
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

  // 大写：只处理 NDJC / BLOCK / LIST / IF / HOOK / RES
  if (/^(NDJC|BLOCK|LIST|IF|HOOK|RES):/i.test(k)) {
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

/* ──────────────── 列表/资源/HOOK 规范化工具 ──────────────── */

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

const ROUTE_BLOCKS: Record<string, string[]> = {
  home: ["BLOCK:ROUTE_HOME"],
  detail: ["BLOCK:ROUTE_DETAIL"],
  post: ["BLOCK:ROUTE_POST"],
};

function canonResKey(k: string): string {
  if (!/^RES:/i.test(k) && /^(drawable|raw|font|mipmap|values|xml)\//i.test(k)) {
    return "RES:" + k.replace(/\\/g, "/");
  }
  return canonKey(k, "RES");
}

const HOOK_CANON: Record<string, string> = {
  "HOOK:BEFORE_BUILD": "HOOK:BEFORE_BUILD",
  "HOOK:AFTER_BUILD": "HOOK:AFTER_BUILD",
  "HOOK:PRE_INJECT": "HOOK:PRE_INJECT",
  "HOOK:POST_INJECT": "HOOK:POST_INJECT",
  "HOOK:PRE_COMMIT": "HOOK:PRE_COMMIT",
  "HOOK:AFTER_INSTALL": "HOOK:AFTER_INSTALL",
};

/* ──────────────── 注册表：别名折叠 + 白名单过滤 ──────────────── */

function applyAliases<T extends Dict<any>>(m: T, aliases?: Record<string, string>): T {
  if (!aliases) return m;
  const out: Dict<any> = {};
  for (const [k, v] of Object.entries(m)) {
    const ck = canonKey(k);
    const target = aliases[ck] || aliases[ck.replace(/^NDJC:/, "")] || ck;
    const tk = canonKey(target);
    // 合并：后写覆盖前写（以 LLM 最新值为准）
    out[tk] = v;
  }
  return out as T;
}

function filterKeys<T extends Dict<any>>(m: T, allow: Set<string>): T {
  if (!m) return m;
  const out: Dict<any> = {};
  for (const [k, v] of Object.entries(m)) {
    const ck = canonKey(k);
    if (allow.has(ck)) out[ck] = v;
  }
  return out as T;
}

function toSet(arr?: Array<string | { key: string }>): Set<string> {
  const s = new Set<string>();
  (arr || []).forEach((it: any) => {
    const k = typeof it === "string" ? it : it?.key;
    if (k) s.add(canonKey(k));
  });
  return s;
}

/* ──────────────── 主转换 ──────────────── */

export function contractV1ToPlan(doc: ContractV1): NdjcPlanV1 {
  const pkg = doc.metadata.packageId;

  // 读取注册表（极简：只用于别名折叠 + 白名单）
  const REG = loadRegistry();
  const ALIASES = REG.aliases || {};
  const ALLOW_TEXT = toSet(REG.textAnchors as any);
  const ALLOW_BLOCK = toSet(REG.blockAnchors);
  const ALLOW_LIST  = toSet(REG.listAnchors);
  const ALLOW_IF    = toSet(REG.ifAnchors);
  const ALLOW_HOOK  = toSet(REG.hookAnchors);
  const ALLOW_RES   = toSet(REG.resourceAnchors);

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

  /* 2) 读取 anchors 四类 + 新增 RES/HOOK 的多源输入（先常规规范化） */
  const textIn   = shallowClone(doc.anchors?.text);
  const blockIn  = shallowClone(doc.anchors?.block);
  const listIn   = shallowClone(doc.anchors?.list);
  const ifIn     = shallowClone(doc.anchors?.if);
  const resIn    = shallowClone((doc as any)?.anchors?.res ?? (doc as any)?.resources);
  const hookIn   = shallowClone((doc as any)?.anchors?.hook ?? (doc as any)?.hooks);

  const textRaw  = normalizeRecord(textIn,  "ndjc") as Dict<string>;
  const blockRaw = normalizeRecord(blockIn, "block") as Dict<string>;
  const listsRaw = normalizeRecord(listIn,  "list")  as Dict<any>;
  const iffRaw   = normalizeRecord(ifIn,    "if")    as Dict<boolean>;
  const resRaw   = normalizeRecord(resIn,   "res")   as Dict<string>;
  const hookRaw  = normalizeRecord(hookIn,  "hook")  as Dict<any>;

  /* 3) 关键文本锚点兜底（保证最小可用） */
  const textBase: Dict<string> = { ...textRaw };
  if (!textBase["NDJC:PACKAGE_NAME"]) textBase["NDJC:PACKAGE_NAME"] = pkg;
  if (!textBase["NDJC:APP_LABEL"])    textBase["NDJC:APP_LABEL"]    = doc.metadata.appName;
  if (!textBase["NDJC:HOME_TITLE"] && doc.metadata.appName) {
    textBase["NDJC:HOME_TITLE"] = doc.metadata.appName;
  }
  if (!textBase["NDJC:PRIMARY_BUTTON_TEXT"]) {
    textBase["NDJC:PRIMARY_BUTTON_TEXT"] = "Start";
  }

  /* 4) 列表类规范化（别名映射 + 数组化） */
  const listsBase: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(listsRaw)) {
    const key = LIST_CANON[k as keyof typeof LIST_CANON] || canonKey(k, "LIST");
    listsBase[key] = toArrayOfString(v);
  }

  // 路由：从 doc.routes 或 anchors -> 统一进 LIST:ROUTES，并自动补齐相关块
  const routesIn: string[] = toArrayOfString(
    (doc as any).routes?.items || (doc as any).routes || listsBase["LIST:ROUTES"]
  );
  if (routesIn.length) {
    listsBase["LIST:ROUTES"] = Array.from(new Set([...(listsBase["LIST:ROUTES"] || []), ...routesIn]));
  }

  /* 5) 资源锚点（RES:*）规范化：支持多源 */
  const resourcesBase: Record<string, string> = {};
  for (const [rk, rv] of Object.entries(resRaw)) {
    resourcesBase[canonResKey(rk)] = String(rv ?? "");
  }
  // 若 LLM 以 files 形式给资源
  if (Array.isArray((doc as any).resources?.files)) {
    for (const f of (doc as any).resources.files) {
      const k = canonResKey(f.key || f.path || f.name || "");
      if (!k) continue;
      resourcesBase[k] = String(f.content ?? "");
    }
  }

  /* 6) HOOK 锚点（HOOK:*）规范化 */
  const hooksBase: Record<string, string[]> = {};
  for (const [hk, hv] of Object.entries(hookRaw)) {
    const ck = HOOK_CANON[canonKey(hk, "HOOK")] || canonKey(hk, "HOOK");
    hooksBase[ck] = toArrayOfString(hv);
  }

  /* 7) 功能模块（增量配方：只标记相关块存在，内容由 LLM/模板兜底） */
  const blockBase: Dict<string> = { ...blockRaw };
  const modsSrc: string[] =
    toArrayOfString((doc as any).modules) ||
    toArrayOfString((doc as any)?.features?.modules);
  if (modsSrc.length) {
    const norm = modsSrc.map(s => String(s).toLowerCase().trim());
    for (const mName of norm) {
      const recipe = {
        feed:   { blocks: ["BLOCK:HOME_HEADER", "BLOCK:HOME_BODY", "BLOCK:HOME_ACTIONS", "BLOCK:ROUTE_HOME"] },
        detail: { blocks: ["BLOCK:ROUTE_DETAIL"] },
        post:   { blocks: ["BLOCK:ROUTE_POST"], lists: { "LIST:POST_FIELDS": ["title", "content"] } },
        comments: { lists: { "LIST:COMMENT_FIELDS": ["author", "content", "time"] } },
        emptystate: { blocks: ["BLOCK:EMPTY_STATE"] },
        topbar: { blocks: [] },
        enhance: { blocks: ["BLOCK:NAV_TRANSITIONS"] },
      } as const;
      // @ts-ignore
      const r = (recipe as any)[mName];
      if (!r) continue;
      (r.blocks || []).forEach((b: string) => { if (!blockBase[b]) blockBase[b] = ""; });
      for (const [lk, lv] of Object.entries(r.lists || {})) {
        const canonLk = LIST_CANON[lk] || canonKey(lk, "LIST");
        const exist = new Set(listsBase[canonLk] || []);
        for (const item of lv) exist.add(String(item));
        listsBase[canonLk] = Array.from(exist);
      }
    }
  }

  /* 8) 按注册表执行：别名折叠 → 白名单过滤 */
  const textAliased  = applyAliases(textBase,  ALIASES);
  const blockAliased = applyAliases(blockBase, ALIASES);
  const listsAliased: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(listsBase)) {
    const mapped = (ALIASES[canonKey(k)] || canonKey(k));
    const mk = canonKey(mapped);
    listsAliased[mk] = v;
  }
  const iffAliased   = applyAliases(iffRaw,    ALIASES);
  const resAliased: Record<string, string> = {};
  for (const [k, v] of Object.entries(resourcesBase)) {
    const mapped = (ALIASES[canonKey(k)] || canonKey(k));
    resAliased[canonResKey(mapped)] = v;
  }
  const hooksAliased = applyAliases(hooksBase, ALIASES);

  const text  = ALLOW_TEXT.size  ? filterKeys(textAliased,  ALLOW_TEXT)  : textAliased;
  const block = ALLOW_BLOCK.size ? filterKeys(blockAliased, ALLOW_BLOCK) : blockAliased;
  const lists = ALLOW_LIST.size  ? filterKeys(listsAliased, ALLOW_LIST)  : listsAliased;
  const iff   = ALLOW_IF.size    ? filterKeys(iffAliased,   ALLOW_IF)    : iffAliased;
  const resources = ALLOW_RES.size ? filterKeys(resAliased, ALLOW_RES)   : resAliased;
  const hooks = ALLOW_HOOK.size  ? filterKeys(hooksAliased, ALLOW_HOOK)  : hooksAliased;

  // 路由相关块（根据 LIST:ROUTES 最终内容补齐一次）
  const routes = lists["LIST:ROUTES"] || [];
  for (const r of routes) {
    const name = String(r).toLowerCase();
    if (ROUTE_BLOCKS[name]) {
      for (const b of ROUTE_BLOCKS[name]) {
        if (!block[b] && (!ALLOW_BLOCK.size || ALLOW_BLOCK.has(b))) block[b] = "";
      }
    }
  }

  /* 9) 伴生文件（仅 B 模式） */
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

  /* 10) 返回计划 */
  return {
    meta: {
      runId: doc.metadata.runId ?? undefined,
      template: doc.metadata.template,
      appName: doc.metadata.appName,
      packageId: pkg,
      mode: doc.metadata.mode,
      templateKey: REG.templateKey || "circle-basic",
      registryVersion: REG.version,
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
