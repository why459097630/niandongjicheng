import type { ContractV1 } from "./types";

/** generator 期望的 plan 形状（扩展 resources/hooks） */
export interface NdjcPlanV1 {
  meta: {
    runId?: string;
    template: string;
    appName: string;
    packageId: string;
    mode: "A" | "B";
  };
  text: Record<string, string>;
  block: Record<string, string>;
  lists: Record<string, string[]>;
  if: Record<string, boolean>;
  resources?: Record<string, string>;
  hooks?: Record<string, string[]>;
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
  companions?: { path: string; content: string; encoding?: "utf8" | "base64" }[];
}

type Dict<T = any> = Record<string, T>;

const ALLOW_COMPANION_CODE =
  (process.env.NDJC_ALLOW_COMPANION_CODE || "false").toLowerCase() === "true";

/* ──────────────── 小工具 ──────────────── */
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

function canonKey(raw: string, prefix?: string): string {
  let k = String(raw || "").trim();
  if (!k) return k;

  if (/^(res(\.|:)|resources:)/i.test(k)) {
    k = k.replace(/^res(\.|:)/i, "RES:").replace(/^resources:/i, "RES:");
    return k.replace(/\\/g, "/");
  }
  if (/^hook(\.|:)/i.test(k)) {
    k = k.replace(/^hook(\.|:)/i, "HOOK:");
    return "HOOK:" + k.slice("HOOK:".length).toUpperCase().replace(/\s+/g, "_");
  }
  if (prefix && !new RegExp(`^${prefix}:`, "i").test(k)) {
    k = `${prefix}:${k}`;
  }
  if (/^(NDJC|BLOCK|LIST|IF):/i.test(k)) {
    const [p, rest] = k.split(":");
    return p.toUpperCase() + ":" + rest.toUpperCase().replace(/\s+/g, "_");
  }
  return k;
}

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
  "HOOK:KOTLIN_IMPORTS": "HOOK:KOTLIN_IMPORTS",
  "HOOK:KOTLIN_TOPLEVEL": "HOOK:KOTLIN_TOPLEVEL",
  "HOOK:BEFORE_BUILD": "HOOK:BEFORE_BUILD",
  "HOOK:AFTER_BUILD": "HOOK:AFTER_BUILD",
  "HOOK:AFTER_INSTALL": "HOOK:AFTER_INSTALL",
};

/* ──────────────── 主转换 ──────────────── */
export function contractV1ToPlan(doc: ContractV1): NdjcPlanV1 {
  const pkg = doc.metadata.packageId;
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

  const textIn   = shallowClone(doc.anchors?.text);
  const blockIn  = shallowClone(doc.anchors?.block);
  const listIn   = shallowClone(doc.anchors?.list);
  const ifIn     = shallowClone(doc.anchors?.if);
  const resIn    = shallowClone((doc as any)?.anchors?.res ?? (doc as any)?.resources);
  const hookIn   = shallowClone((doc as any)?.anchors?.hook ?? (doc as any)?.hooks);

  const text  = Object.fromEntries(Object.entries(textIn || {}).map(([k,v]) => [canonKey(k,"NDJC"), String(v ?? "")]));
  const block = Object.fromEntries(Object.entries(blockIn|| {}).map(([k,v]) => [canonKey(k,"BLOCK"), String(v ?? "")]));
  const listsRaw = Object.fromEntries(Object.entries(listIn || {}).map(([k,v]) => [canonKey(k,"LIST"), v]));
  const iff   = Object.fromEntries(Object.entries(ifIn   || {}).map(([k,v]) => [canonKey(k,"IF"), toBool(v)]));

  const resources: Record<string, string> = {};
  for (const [rk, rv] of Object.entries(resIn || {})) {
    resources[canonResKey(rk)] = String(rv ?? "");
  }
  if (Array.isArray((doc as any).resources?.files)) {
    for (const f of (doc as any).resources.files) {
      const k = canonResKey(f.key || f.path || f.name || "");
      if (!k) continue; resources[k] = String(f.content ?? "");
    }
  }

  const hooks: Record<string, string[]> = {};
  for (const [hk, hv] of Object.entries(hookIn || {})) {
    const ck = HOOK_CANON[canonKey(hk, "HOOK")] || canonKey(hk, "HOOK");
    const arr = toArrayOfString(hv);
    hooks[ck] = arr;
  }

  const lists: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(listsRaw)) {
    const canon = LIST_CANON[k] || k;
    lists[canon] = toArrayOfString(v);
  }

  // 从 routes 推导路由块
  const routesIn: string[] = toArrayOfString((doc as any).routes?.items || (doc as any).routes || lists["LIST:ROUTES"]);
  if (routesIn.length) {
    lists["LIST:ROUTES"] = Array.from(new Set([...(lists["LIST:ROUTES"] || []), ...routesIn]));
    for (const r of routesIn) {
      const name = String(r).toLowerCase();
      if (ROUTE_BLOCKS[name]) {
        for (const b of ROUTE_BLOCKS[name]) if (!block[b]) block[b] = "";
      }
    }
  }

  // 文本关键兜底
  if (!text["NDJC:PACKAGE_NAME"]) text["NDJC:PACKAGE_NAME"] = pkg;
  if (!text["NDJC:APP_LABEL"])    text["NDJC:APP_LABEL"]    = doc.metadata.appName || "NDJC App";
  if (!text["NDJC:HOME_TITLE"])   text["NDJC:HOME_TITLE"]   = doc.metadata.appName || "Home";
  if (!text["NDJC:PRIMARY_BUTTON_TEXT"]) text["NDJC:PRIMARY_BUTTON_TEXT"] = "Start";

  // companions：严格默认禁止源码
  let companions = (doc.files || []).filter((f: any) => f.kind !== "manifest_patch");
  if (!ALLOW_COMPANION_CODE) {
    companions = companions.filter((f: any) => {
      const p = (f.path || "").toLowerCase();
      return !(p.endsWith(".kt") || p.endsWith(".java"));
    });
  }

  return {
    meta: {
      runId: doc.metadata.runId ?? undefined,
      template: doc.metadata.template,
      appName: doc.metadata.appName,
      packageId: pkg,
      mode: doc.metadata.mode as any,
    },
    text,
    block,
    lists,
    if: iff,
    resources,
    hooks,
    gradle,
    companions,
  };
}
