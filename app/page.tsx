"use client";
import React from "react";

// 组合构建可选项
const MODULE_TO_TEMPLATE_KEY: Record<string, string> = {
  "feature-restaurant-menu-full": "shop-basic",
  "feature-home-basic": "showcase-basic",
  "feature-about-basic": "showcase-basic",
};

const DEFAULT_UI_PACKS = ["ui-pack-neumorph", "ui-pack-restaurant-soft-pastel"] as const;
const DEFAULT_MODULES = ["feature-restaurant-menu-full", "feature-home-basic", "feature-about-basic"] as const;

type DisplayTemplate = keyof typeof MODULE_TO_TEMPLATE_KEY;
type Mode = "A" | "B"; // A = safe extract only, B = allow companions
type ApiResp = {
  ok: boolean;
  runId?: string;
  committed?: boolean;
  actionsUrl?: string | null;
  error?: string;
};

// 生成唯一的 Run ID
function utcRunId(prefix = "ndjc") {
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

export default function Page() {
  const [appName, setAppName] = React.useState<string>("NDJC App");
  const [uiPack, setUiPack] = React.useState<string>(DEFAULT_UI_PACKS[0]);
  const [modules, setModules] = React.useState<string[]>([DEFAULT_MODULES[0]]);
  const [uploadedIcon, setUploadedIcon] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resp, setResp] = React.useState<ApiResp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // Handle file upload (icon)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (file) {
      const validTypes = ["image/png", "image/jpeg", "image/svg+xml"]; // Supported file formats
      const maxSize = 2 * 1024 * 1024; // 2MB max file size

      if (!validTypes.includes(file.type)) {
        alert("请选择有效的图标文件格式 (PNG, JPEG, SVG)");
        return;
      }

      if (file.size > maxSize) {
        alert("图标文件大小不能超过 2MB");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedIcon(reader.result as string); // Store the uploaded icon preview
      };
      reader.readAsDataURL(file); // Convert the file to a data URL for preview
    }
  };

  // Handle removing the uploaded icon
  const handleRemoveIcon = () => {
    setUploadedIcon(null); // Clear the uploaded icon
  };

  // Submit selection form (combination build)
  async function submitSelection(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResp(null);

    const runId = utcRunId();

    try {
      const body = {
        run_id: runId,
        appName: appName.trim(),
        uiPack,
        modules,
      };

      const r = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await r.text();
      let json: ApiResp;
      try {
        json = JSON.parse(text);
      } catch {
        json = { ok: false, error: text } as any;
      }

      if (!r.ok || !json.ok) setErr(json.error || `HTTP ${r.status}`);

      setResp({ ...json, runId });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const selectedModule = modules[0] || "";
  const selectedTemplateKey = MODULE_TO_TEMPLATE_KEY[selectedModule] || "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* 背景氛围层 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.10),transparent_55%)]" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 py-10">
        {/* 顶部标题区 */}
        <header className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            NDJC · Native APK Pipeline
          </div>

          <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
            NDJC · 原生 APK 生成器
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            选择构建方式：<span className="font-medium text-slate-100">组合构建</span>（勾选模块/UI → 触发 Actions）
            或 <span className="font-medium text-slate-100">自然语言生成</span>（LLM 编排生成）。
          </p>
        </header>

        {/* 主卡片 */}
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur md:p-7">
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-slate-300">当前模式</div>
              <div className="mt-1 text-sm font-medium text-slate-100">组合构建</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-slate-300">模块映射模板</div>
              <div className="mt-1 text-sm font-medium text-slate-100">
                {selectedTemplateKey ? selectedTemplateKey : "—"}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {selectedModule ? `来自：${selectedModule}` : "请选择模块以显示 template_key"}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs text-slate-300">构建状态</div>
              <div className="mt-1 text-sm font-medium text-slate-100">
                {busy ? "触发中…" : resp?.runId ? "已触发" : "待触发"}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {resp?.runId ? `RunId: ${resp.runId}` : "提交后将生成 RunId"}
              </div>
            </div>
          </div>

          {/* 组合构建表单（逻辑不动，只换 UI） */}
          <form onSubmit={submitSelection} className="space-y-6">
            {/* App 名称 */}
            <div className="grid grid-cols-1 gap-2">
              <label className="text-sm font-medium text-slate-200">App 名称</label>
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="例如：Restaurant Menu"
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 shadow-sm outline-none ring-0 focus:border-white/20 focus:bg-black/30"
              />
              <div className="text-xs text-slate-400">
                将随请求提交到 <span className="font-mono text-slate-200">/api/build</span>（后端写入 Manifest / APP_LABEL）。
              </div>
            </div>

            {/* 图标上传 */}
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-200">上传图标</label>
                <div className="text-xs text-slate-400">PNG / JPEG / SVG · ≤ 2MB</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/svg+xml"
                  onChange={handleFileChange}
                  className="block w-full cursor-pointer text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-white/15"
                />

                {uploadedIcon ? (
                  <div className="mt-4 flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/30">
                      <img src={uploadedIcon} alt="Uploaded Icon" className="h-10 w-10 object-contain" />
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-slate-300">图标预览已加载</div>
                      <div className="mt-1 text-xs text-slate-500">
                        当前仅做前端预览；若需随构建提交到后端，需要在 <span className="font-mono">submitSelection</span> 增加上传字段（后续再做）。
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveIcon}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 hover:bg-white/10"
                    >
                      删除图标
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-slate-500">未选择文件</div>
                )}
              </div>
            </div>

            {/* 逻辑模块选择 */}
            <div className="grid grid-cols-1 gap-2">
              <label className="text-sm font-medium text-slate-200">选择逻辑模块</label>
              <div className="flex flex-wrap gap-2">
                {["feature-restaurant-menu-full", "feature-home-basic", "feature-about-basic"].map((module) => {
                  const active = modules.includes(module);
                  return (
                    <button
                      type="button"
                      key={module}
                      onClick={() => setModules([module])}
                      className={[
                        "rounded-2xl px-4 py-2 text-sm transition shadow-sm",
                        "border",
                        active
                          ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-50"
                          : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                      ].join(" ")}
                    >
                      {module}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-slate-500">
                当前为单选（点击后覆盖为一个模块）：<span className="font-mono text-slate-300">{selectedModule || "—"}</span>
              </div>
            </div>

            {/* UI 包选择 */}
            <div className="grid grid-cols-1 gap-2">
              <label className="text-sm font-medium text-slate-200">UI 包</label>
              <div className="flex flex-wrap gap-2">
                {["ui-pack-neumorph", "ui-pack-restaurant-soft-pastel"].map((pack) => {
                  const active = uiPack === pack;
                  return (
                    <button
                      type="button"
                      key={pack}
                      onClick={() => setUiPack(pack)}
                      className={[
                        "rounded-2xl px-4 py-2 text-sm transition shadow-sm",
                        "border",
                        active
                          ? "border-sky-400/30 bg-sky-500/15 text-sky-50"
                          : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                      ].join(" ")}
                    >
                      {pack}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 提交按钮 */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-xs text-slate-500">
                提交后将触发后端构建：<span className="font-mono text-slate-300">POST /api/build</span>
              </div>

              <button
                type="submit"
                disabled={busy || modules.length === 0 || !appName.trim()}
                className={[
                  "rounded-2xl px-5 py-2.5 text-sm font-medium shadow-sm transition",
                  busy || modules.length === 0 || !appName.trim()
                    ? "bg-white/10 text-slate-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-emerald-500/90 to-sky-500/90 text-white hover:from-emerald-500 hover:to-sky-500",
                ].join(" ")}
              >
                {busy ? "触发中…" : "触发构建"}
              </button>
            </div>
          </form>

          {/* 错误或状态反馈 */}
          {err && (
            <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
              {err}
            </div>
          )}

          {resp && resp.runId && (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-200">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs text-slate-400">构建已触发</div>
                  <div className="mt-1 font-mono text-sm text-slate-100">{resp.runId}</div>
                </div>

                {resp.actionsUrl ? (
                  <a
                    href={resp.actionsUrl}
                    target="_blank"
                    className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10"
                  >
                    查看构建进度
                  </a>
                ) : (
                  <div className="text-xs text-slate-500">actionsUrl 暂无返回</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="mt-6 text-center text-xs text-slate-500">
          NDJC Frontend · 保持现有构建逻辑不变，仅优化 UI 展示
        </div>
      </div>
    </div>
  );
}
