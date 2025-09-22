"use client";
import React from "react";

/**
 * NDJC Frontend Home – 5 template picker with clear descriptions.
 * Fixes: ReferenceError: TEMPLATE_KEY_MAP is not defined
 * Root cause: variable referenced before declaration in earlier edits.
 * Resolution: define TEMPLATE_KEY_MAP (and its descriptions) at top-level
 * before any usage; add dev-time sanity checks.
 */

// ===== Template keys shown on the homepage =====
// Display labels map to actual template_key used by the orchestrator/generator
const TEMPLATE_KEY_MAP = {
  circle: "circle-basic",
  flow: "flow-basic",
  map: "map-basic",
  shop: "shop-basic",
  showcase: "showcase-basic",
} as const;

// Descriptions shown under the template buttons
const TEMPLATE_DESC: Record<keyof typeof TEMPLATE_KEY_MAP, string> = {
  circle: "Circle：社交圈子类 App，适合发帖、评论、点赞等互动场景。",
  flow: "Flow：任务/流程驱动类 App，适合步骤引导、审批流与状态流转。",
  map: "Map：地图/定位类 App，适合标记点、路径导航、附近 POI 展示。",
  shop: "Shop：商品/下单类 App，适合电商、下单、购物车与订单管理。",
  showcase: "Showcase：展示类 App，适合作品集、展览、活动介绍等信息呈现。",
};

type DisplayTemplate = keyof typeof TEMPLATE_KEY_MAP; // circle | flow | map | shop | showcase

type Mode = "A" | "B"; // A = safe extract only, B = allow companions

type ApiResp = {
  ok: boolean;
  runId?: string;
  committed?: boolean;
  actionsUrl?: string | null;
  degraded?: boolean | null;
  error?: string;
  stack?: string;
};

// Helpers
function utcRunId(prefix = "ndjc") {
  // ndjc-YYYYmmddTHHMMSSZ
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z";
  return `${prefix}-${ts}`;
}

function inferPreset(spec: string): "minimal" | "social" | "i18n" {
  const s = spec.toLowerCase();
  const hasSocial = /(发帖|发布|评论|点赞|post|comment|like)/.test(s);
  const hasI18n = /(多语言|国际化|i18n|language|locale)/.test(s);
  if (hasI18n) return "i18n";
  if (hasSocial) return "social";
  return "minimal";
}

export default function Page() {
  const [template, setTemplate] = React.useState<DisplayTemplate>("circle");
  const [mode, setMode] = React.useState<Mode>("A");
  const [spec, setSpec] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [resp, setResp] = React.useState<ApiResp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [health, setHealth] = React.useState<null | { ok: boolean; port?: number }>(null);

  // Debug panes
  const [reqBody, setReqBody] = React.useState<any>(null);
  const [rawResp, setRawResp] = React.useState<string>("");
  const [showDebug, setShowDebug] = React.useState<boolean>(false);
  const [debugTab, setDebugTab] = React.useState<"json" | "raw" | "req">("json");

  // ==== Dev-time sanity checks ("tests") – won't break UI even if failed ====
  React.useEffect(() => {
    // Ensure constants exist and have expected shape
    console.assert(!!TEMPLATE_KEY_MAP, "TEMPLATE_KEY_MAP must exist");
    const keys = Object.keys(TEMPLATE_KEY_MAP);
    console.assert(keys.includes("circle"), "circle key should exist");
    console.assert(typeof TEMPLATE_KEY_MAP.circle === "string", "template value must be string");
  }, []);

  async function ping() {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      const j = await r.json();
      setHealth(j);
    } catch (e) {
      setHealth({ ok: false });
    }
  }

  React.useEffect(() => { ping(); }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResp(null);
    const runId = utcRunId();
    try {
      const template_key = TEMPLATE_KEY_MAP[template];
      const body = {
        // New recommended fields
        run_id: runId,
        template_key,                             // precisely selects one of the 5 templates
        nl: spec.trim(),                          // natural language requirement
        preset_hint: inferPreset(spec),           // minimal/social/i18n
        mode,                                     // A|B
        allowCompanions: mode === "B",
        // Back-compat (some older backends look at these):
        template: template_key,
        requirement: spec.trim(),
      };
      setReqBody(body);
      const r = await fetch("/api/generate-apk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let json: ApiResp;
      const text = await r.text();
      setRawResp(text);
      try { json = JSON.parse(text); } catch { json = { ok: false, error: text } as any; }
      if (!r.ok || !json.ok) {
        setErr(json.error || `HTTP ${r.status}`);
      }
      setResp({ ...json, runId });
      setShowDebug(true);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">NDJC · 原生 APK 生成器</h1>
          <p className="text-slate-600 mt-2">输入自然语言需求 → 选择模板（circle/flow/map/shop/showcase）→ 选择模式 → 服务端生成（编排 → 物化 → 锚点替换 → 打包）。</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1 text-sm">
            <span className={`inline-block size-2 rounded-full ${health?.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
            <span>API {health?.ok ? "在线" : "离线"}</span>
            <button onClick={ping} className="ml-2 rounded-lg px-2 py-0.5 hover:bg-slate-200">刷新</button>
          </div>
        </header>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* 模板选择：5 个范式 */}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">模板</label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(TEMPLATE_KEY_MAP) as DisplayTemplate[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTemplate(t)}
                  className={`capitalize rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${template===t?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300 hover:border-slate-400"}`}
                >{t}</button>
              ))}
            </div>
            {/* 模板说明 */}
            <p className="text-xs text-slate-500 mt-1">{TEMPLATE_DESC[template]}</p>
          </div>

          {/* 工作模式选择（方案A/方案B） */}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">工作模式</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("A")}
                className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${mode==="A"?"bg-emerald-600 text-white border-emerald-600":"bg-white text-slate-700 border-slate-300 hover:border-slate-400"}`}
              >方案A（安全，LLM 抽取字段）</button>
              <button
                type="button"
                onClick={() => setMode("B")}
                className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${mode==="B"?"bg-amber-600 text-white border-amber-600":"bg-white text-slate-700 border-slate-300 hover:border-slate-400"}`}
              >方案B（实验，允许伴生代码）</button>
            </div>
            <p className="text-xs text-slate-500 mt-1">A 稳定可控；B 发散更强，需后端白名单和沙箱。</p>
          </div>

          {/* 自然语言需求 */}
          <div>
            <label htmlFor="spec" className="text-sm font-medium text-slate-700">自然语言需求</label>
            <textarea
              id="spec"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder={`例如：\n做一个圈子首页（circle），可以发帖和评论，应用名叫 NDJC Circle；\n支持中文和英文；图标用默认占位。`}
              className="mt-2 w-full min-h-[160px] rounded-2xl border border-slate-300 bg-white p-4 leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={busy || !spec.trim()}
              className={`rounded-2xl px-5 py-2.5 text-sm font-medium shadow-sm transition ${busy?"bg-slate-300 text-slate-600":"bg-slate-900 text-white hover:bg-slate-800"}`}
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin size-4" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity=".2"/>
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  </svg>
                  生成中…
                </span>
              ) : (
                <span>生成 APK</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSpec("")}
              className="rounded-2xl px-4 py-2 text-sm border border-slate-300 hover:bg-slate-50"
            >清空</button>
          </div>
        </form>

        {(err || resp) && (
          <section className="mt-8 grid gap-4">
            {err && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
                <div className="font-semibold mb-1">出错了</div>
                <pre className="whitespace-pre-wrap text-sm">{err}</pre>
              </div>
            )}

            {resp && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">生成结果</h3>
                  {resp?.runId && (
                    <button
                      onClick={() => copy(resp.runId!)}
                      className="text-xs rounded-lg px-2 py-1 border border-slate-300 hover:bg-slate-50"
                    >复制 runId</button>
                  )}
                </div>
                <div className="mt-3 text-sm text-slate-700">
                  {resp?.ok ? (
                    <>
                      <p>已触发：编排 → 物化模板 → 锚点替换 → 提交/构建。</p>
                      {resp.runId && (
                        <>
                          <p className="mt-2">审计目录：<code className="rounded bg-slate-100 px-1 py-0.5">requests/{resp.runId}</code></p>
                          <p className="mt-1">工作分支：<code className="rounded bg-slate-100 px-1 py-0.5">ndjc-run/{resp.runId}</code>（如启用）</p>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-2">后端返回：</p>
                      <pre className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap">{JSON.stringify(resp, null, 2)}</pre>
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Debug */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="font-semibold">API 调试输出</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDebug(v=>!v)} className="text-xs rounded-lg px-2 py-1 border border-slate-300 hover:bg-slate-50">
                {showDebug ? "收起" : "展开"}
              </button>
            </div>
          </div>
          {showDebug && (
            <div className="px-4 pb-4">
              <div className="mb-2 flex gap-2 text-xs">
                <button onClick={()=>setDebugTab("json")} className={`rounded-md px-2 py-1 border ${debugTab==="json"?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300"}`}>JSON</button>
                <button onClick={()=>setDebugTab("raw")} className={`rounded-md px-2 py-1 border ${debugTab==="raw"?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300"}`}>Raw</button>
                <button onClick={()=>setDebugTab("req")} className={`rounded-md px-2 py-1 border ${debugTab==="req"?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300"}`}>Request</button>
              </div>
              {debugTab === "json" && (
                <pre className="whitespace-pre-wrap text-xs bg-slate-50 rounded-xl p-3 overflow-auto">{resp ? JSON.stringify(resp, null, 2) : "(暂无)"}</pre>
              )}
              {debugTab === "raw" && (
                <pre className="whitespace-pre-wrap text-xs bg-slate-50 rounded-xl p-3 overflow-auto">{rawResp || "(暂无)"}</pre>
              )}
              {debugTab === "req" && (
                <pre className="whitespace-pre-wrap text-xs bg-slate-50 rounded-xl p-3 overflow-auto">{reqBody ? JSON.stringify(reqBody, null, 2) : "(暂无)"}</pre>
              )}
            </div>
          )}
        </section>

        <footer className="mt-12 text-xs text-slate-500">
          <p>
            本页会发送 <code>run_id</code>、<code>template_key</code>、<code>nl</code>、<code>preset_hint</code>、<code>mode</code>、<code>allowCompanions</code>
            到 <code>/api/generate-apk</code>。为兼容旧后端，同时附带 <code>template</code> 与 <code>requirement</code> 字段。
          </p>
        </footer>
      </div>
    </div>
  );
}
