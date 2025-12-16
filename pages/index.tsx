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
      const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml']; // Supported file formats
      const maxSize = 2 * 1024 * 1024; // 2MB max file size

      if (!validTypes.includes(file.type)) {
        alert('请选择有效的图标文件格式 (PNG, JPEG, SVG)');
        return;
      }

      if (file.size > maxSize) {
        alert('图标文件大小不能超过 2MB');
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">NDJC · 原生 APK 生成器</h1>
          <p className="text-slate-600 mt-2">
            选择构建方式：<span className="font-medium">组合构建</span> 或
            <span className="font-medium">自然语言生成</span>（LLM 编排生成）。
          </p>
        </header>

        {/* 组合构建表单 */}
        <form onSubmit={submitSelection} className="space-y-5">
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">App 名称</label>
            <input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="例如：Restaurant Menu"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>

          {/* 用户上传图标 */}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">上传图标</label>
            <input
              type="file"
              accept="image/png, image/jpeg, image/svg+xml"
              onChange={handleFileChange}
              className="border p-2 rounded"
            />
            {uploadedIcon && (
              <div className="mt-2">
                <p className="text-xs text-slate-500">图标预览：</p>
                <img src={uploadedIcon} alt="Uploaded Icon" className="w-16 h-16 object-contain" />
                <button
                  type="button"
                  onClick={handleRemoveIcon}
                  className="mt-2 text-sm text-red-500"
                >
                  删除图标
                </button>
              </div>
            )}
          </div>

          {/* 逻辑模块选择 */}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">选择逻辑模块</label>
            <div className="flex flex-wrap gap-2">
              {['feature-restaurant-menu-full', 'feature-home-basic', 'feature-about-basic'].map((module) => (
                <button
                  type="button"
                  key={module}
                  onClick={() => setModules([module])}
                  className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${
                    modules.includes(module)
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {module}
                </button>
              ))}
            </div>
          </div>

          {/* UI 包选择 */}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-sm font-medium text-slate-700">UI 包</label>
            <div className="flex flex-wrap gap-2">
              {['ui-pack-neumorph', 'ui-pack-restaurant-soft-pastel'].map((pack) => (
                <button
                  type="button"
                  key={pack}
                  onClick={() => setUiPack(pack)}
                  className={`rounded-2xl px-4 py-2 border text-sm transition shadow-sm ${
                    uiPack === pack
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {pack}
                </button>
              ))}
            </div>
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={busy || modules.length === 0 || !appName.trim()}
            className={`rounded-2xl px-5 py-2.5 text-sm font-medium shadow-sm transition ${
              busy ? 'bg-slate-300 text-slate-600' : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {busy ? "触发中…" : "触发构建"}
          </button>
        </form>

        {/* 错误或状态反馈 */}
        {err && <div className="text-red-500 mt-4">{err}</div>}
        {resp && resp.runId && (
          <div className="mt-4">
            <p>构建已触发，运行 ID：{resp.runId}</p>
            {resp.actionsUrl && <a href={resp.actionsUrl} target="_blank" className="text-blue-500">查看构建进度</a>}
          </div>
        )}
      </div>
    </div>
  );
}
