"use client";
import React from "react";

// ====== NDJC Frontend Home ======

const TEMPLATE_KEY_MAP = {
  circle: "circle-basic",
  flow: "flow-basic",
  map: "map-basic",
  shop: "shop-basic",
  showcase: "showcase-basic",
} as const;

type DisplayTemplate = keyof typeof TEMPLATE_KEY_MAP;

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

type BuildStatusResp = {
  ok: boolean;
  runId?: string;
  status?: "queued" | "running" | "success" | "failure" | "unknown";
  actionsUrl?: string | null;
  artifactUrl?: string | null;
  error?: string;
};

// ===== 组合构建可选项 =====
const MODULE_TO_TEMPLATE_KEY: Record<string, string> = {
  "feature-restaurant-menu-full": "shop-basic",
  "feature-home-basic": "showcase-basic",
  "feature-about-basic": "showcase-basic",
};

function templateKeyFromModules(mods: string[]) {
  const first = mods?.[0];
  return (first && MODULE_TO_TEMPLATE_KEY[first]) || "core-skeleton";
}

const DEFAULT_UI_PACKS = ["ui-pack-neumorph", "ui-pack-restaurant-soft-pastel"] as const;
const DEFAULT_MODULES = ["feature-restaurant-menu-full", "feature-home-basic", "feature-about-basic"] as const;

type BuildType = "selection";

// Generate unique run ID based on UTC timestamp
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

function inferPreset(spec: string): "minimal" | "social" | "i18n" {
  const s = spec.toLowerCase();
  const hasSocial = /(发帖|发布|评论|点赞|post|comment|like)/.test(s);
  const hasI18n = /(多语言|国际化|i18n|language|locale)/.test(s);
  if (hasI18n) return "i18n";
  if (hasSocial) return "social";
  return "minimal";
}

function copy(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export default function Page() {
  const [buildType] = React.useState<BuildType>("selection");

  const [template] = React.useState<DisplayTemplate>("circle");
  const [mode, setMode] = React.useState<Mode>("A");
  const [spec, setSpec] = React.useState<string>("");

  const [uiPack, setUiPack] = React.useState<string>(DEFAULT_UI_PACKS[0]);
  const [appName, setAppName] = React.useState<string>("NDJC App");
  const [iconPrompt, setIconPrompt] = React.useState<string>("");
  const [modules, setModules] = React.useState<string[]>([DEFAULT_MODULES[0]]);

  const [busy, setBusy] = React.useState(false);
  const [resp, setResp] = React.useState<ApiResp | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [health, setHealth] = React.useState<null | { ok: boolean; port?: number }>(null);

  const [reqBody, setReqBody] = React.useState<any>(null);
  const [rawResp, setRawResp] = React.useState<string>("");
  const [showDebug, setShowDebug] = React.useState<boolean>(false);
  const [debugTab, setDebugTab] = React.useState<"json" | "raw" | "req">("json");

  const [statusBusy, setStatusBusy] = React.useState(false);
  const [buildStatus, setBuildStatus] = React.useState<BuildStatusResp | null>(null);

  const [uploadedIcon, setUploadedIcon] = React.useState<string | null>(null); // To store the uploaded icon's preview

  // Handle file upload (icon)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files ? e.target.files[0] : null;
    if (file) {
      const validTypes = ['image/png', 'image/jpeg', 'image/svg+xml']; // Supported file formats
      const maxSize = 2 * 1024 * 1024; // 2MB max file size

      // Validate file format and size
      if (!validTypes.includes(file.type)) {
        alert('请选择有效的图标文件格式 (PNG, JPEG, SVG)');
        return;
      }

      if (file.size > maxSize) {
        alert('图标文件大小不能超过 2MB');
        return;
      }

      // Generate preview for the uploaded icon
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

  const body = {
    appName: appName.trim(),
    iconPrompt: iconPrompt.trim(),
    uiPack,
    modules,
  };

  // Submit selection form (combination build)
  async function submitSelection(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResp(null);
    setBuildStatus(null);

    const runId = utcRunId();

    try {
      const template_key = templateKeyFromModules(modules);
      const body = {
        run_id: runId,
        template_key,
        appName: appName.trim(),
        iconPrompt: iconPrompt.trim(),
        uiPack,
        modules,
      };
      setReqBody(body);

      const r = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await r.text();
      setRawResp(text);

      let json: ApiResp;
      try {
        json = JSON.parse(text);
      } catch {
        json = { ok: false, error: text } as any;
      }

      if (!r.ok || !json.ok) setErr(json.error || `HTTP ${r.status}`);

      setResp({ ...json, runId });
      setShowDebug(true);
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
            选择构建方式：
            <span className="font-medium">组合构建</span>（勾选模块/UI 包 → 触发 Actions 脚本装配构建）或
            <span className="font-medium">自然语言生成</span>（LLM 编排生成）。
          </p>
        </header>

        {/* 组合构建表单 */}
        {buildType === "selection" && (
          <form onSubmit={submitSelection} className="space-y-5">
            {/* App 名称输入 */}
            <div className="grid grid-cols-1 gap-2">
              <label className="text-sm font-medium text-slate-700">App 名称</label>
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="例如：Restaurant Menu"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <p className="text-xs text-slate-500">
                该字段会随 /api/build 一起提交给后端，用于写入 Manifest / APP_LABEL（由后端/编排器落地）。
              </p>
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
              <p className="text-xs text-slate-500">
                请选择一个图标文件。支持 PNG, JPEG, SVG 格式，最大文件大小为 2MB。上传的图标将用于生成应用的桌面图标。
              </p>
              <p className="text-xs text-slate-500">
                图标分辨率要求：推荐 512x512 px。
              </p>
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
        )}
      </div>
    </div>
  );
}
