"use client";
import React from "react";

type Template = "core" | "simple" | "form";
// 新增：两种工作模式
// A = 方案A（编排器内调用LLM做字段抽取，安全可控）
// B = 方案B（允许伴生代码/更发散，实验特性）
type Mode = "A" | "B";

type ApiResp = {
  ok: boolean;
  runId?: string;
  committed?: boolean;
  actionsUrl?: string | null;
  degraded?: boolean | null;
  error?: string;
  stack?: string;
};

export default function Page() {
  const [template, setTemplate] = React.useState<Template>("core");
  const [mode, setMode] = React.useState<Mode>("A"); // ★ 新增：模式选择
  const [spec, setSpec] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);
  const [resp, setResp] = React.useState<ApiResp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [health, setHealth] = React.useState<null | { ok: boolean; port?: number }>(null);

  // === 调试：请求体 / 原始响应文本 / 是否展开 ===
  const [reqBody, setReqBody] = React.useState<any>(null);
  const [rawResp, setRawResp] = React.useState<string>("");
  const [showDebug, setShowDebug] = React.useState<boolean>(false);
  const [debugTab, setDebugTab] = React.useState<"json" | "raw" | "req">("json");

  async function ping() {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      const j = await r.json();
      setHealth(j);
    } catch (e) {
      setHealth({ ok: false });
    }
  }

  React.useEffect(() => {
    ping();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResp(null);
    try {
      const body = {
        template,
        requirement: spec.trim(), // ★ 自然语言需求
        mode,                     // ★ 新增：A/B 模式会传到后端
        allowCompanions: mode === "B", // ★ 给后端显式信号（方案B才允许伴生代码）
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
      setResp(json);
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
          <p className="text-slate-600 mt-2">输入自然语言需求 → 选择模式（方案A/方案B）→ 服务端生成（物化模板 → 锚点替换 → 清理）。</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1 text-sm">
            <span className={`inline-block size-2 rounded-full ${health?.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
            <span>API {health?.ok ? "在线" : "离线"}</span>
            <button onClick={ping} className="ml-2 rounded-lg px-2 py-0.5 hover:bg-slate-200">刷新</button>
          </div>
        </header>

        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4">
            <label className="text-sm font-medium text-slate-700">模板</label>
            <div className="flex flex-wrap gap-2">
              {(["core","simple","form"] as Template[]).map(t => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTemplate(t)}
                  className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${template===t?"bg-slate-900 text-white border-slate-900":"bg-white text-slate-700 border-slate-300 hover:border-slate-400"}`}
                >{t}</button>
              ))}
            </div>
          </div>

          {/* 新增：工作模式选择（方案A/方案B） */}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">工作模式</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("A")}
                className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${mode==="A"?"bg-emerald-600 text-white border-emerald-600":"bg-white text-slate-700 border-slate-300 hover:border-slate-400"}`}
              >方案A（安全，LLM做字段抽取）</button>
              <button
                type="button"
                onClick={() => setMode("B")}
                className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${mode==="B"?"bg-amber-600 text-white border-amber-600":"bg-white text-slate-700 border-slate-300 hover:border-slate-400"}`}
              >方案B（实验，允许伴生代码）</button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              A：LLM 只把人话抽成字段，强校验，产出更稳定；B：可让模型生成伴生代码/资源（需后端开启白名单与沙箱）。
            </p>
          </div>

          <div>
            <label htmlFor="spec" className="text-sm font-medium text-slate-700">自然语言需求</label>
            <textarea
              id="spec"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder={`例如：
做一个会议记录应用：
- APP 名叫「速记会议」
- 首页标题“会议速记”，主按钮“开始录音”
- 需要 INTERNET/ACCESS_NETWORK_STATE 权限
- 能处理 https://meet.example.com 链接
- 中英文双语`}
              className="mt-2 w-full min-h-[180px] rounded-2xl border border-slate-300 bg-white p-4 leading-relaxed shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
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
                      <p>已触发服务端流程（编排 → 物化 → 锚点替换 → 清理）。</p>
                      {resp.runId && (
                        <>
                          <p className="mt-2">審計目录（服务器本地）：<code className="rounded bg-slate-100 px-1 py-0.5">requests/{resp.runId}</code></p>
                          <p className="mt-1">工作区：<code className="rounded bg-slate-100 px-1 py-0.5">Packaging-warehouse/app</code></p>
                        </>
                      )}
                      <p className="mt-3 text-slate-500">如需 Release 构建/签名，请在服务器运行 <code>accept-core.ps1</code> 或对应脚本。</p>
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

        {/* === API 调试窗口 === */}
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
          <p>提示：本页会把 <code>template</code>、<code>requirement</code>、<code>mode</code>、<code>allowCompanions</code> 发送到 <code>/api/generate-apk</code>。后端需按 <code>mode</code> 决定是否启用伴生代码（方案B）。</p>
        </footer>
      </div>
    </div>
  );
}
