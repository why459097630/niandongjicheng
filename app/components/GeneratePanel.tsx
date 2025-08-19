// app/components/GeneratePanel.tsx
'use client';

import React, { useMemo, useState } from 'react';

type GhFile = { path: string; sha?: string };
type ApiOk = { ok: true; appId: string; template: string; files: GhFile[] };
type ApiFail = { ok: false; error: string; detail?: any };
type ApiResp = ApiOk | ApiFail;

const API_SECRET = (process.env.NEXT_PUBLIC_API_SECRET || '') as string;

// 三个固定模板
const TEMPLATE_OPTIONS = [
  { value: 'core-template', label: 'Core 模板' },
  { value: 'form-template', label: 'Form 模板' },
  { value: 'simple-template', label: 'Simple 模板' },
] as const;

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState(
    '生成一个包含计时器功能的安卓 App（按下开始按钮后倒计时，支持停止），主界面要简洁'
  );
  const [template, setTemplate] = useState<(typeof TEMPLATE_OPTIONS)[number]['value']>(
    'core-template'
  );
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [openDetail, setOpenDetail] = useState(false);

  const canSubmit = useMemo(
    () => !!template && prompt.trim().length > 0 && !loading,
    [template, prompt, loading]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setResp(null);

    try {
      const r = await fetch('/api/generate-apk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': API_SECRET,
        },
        body: JSON.stringify({
          prompt,
          template, // 只按选择传给后端
        }),
      });

      const data = (await r.json()) as ApiResp;
      setResp(data);
    } catch (err: any) {
      setResp({ ok: false, error: err?.message || 'Network error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl bg-[#121834] p-6 shadow-lg ring-1 ring-white/10">
      {/* 输入 */}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-white/80">需求描述（prompt）</label>
          <textarea
            className="h-36 w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="描述你想要的应用功能、界面、行为……"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-white/80">模板</label>
          <select
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-indigo-500"
            value={template}
            onChange={(e) =>
              setTemplate(e.target.value as (typeof TEMPLATE_OPTIONS)[number]['value'])
            }
          >
            {TEMPLATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}（{opt.value}）
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-white/50">
            请选择一个模板（<code>core-template</code> / <code>form-template</code> /{' '}
            <code>simple-template</code>），系统不会自动匹配。
          </p>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? '正在写入仓库并触发 CI…' : 'Generate APK'}
        </button>
      </form>

      {/* 结果 */}
      <div className="mt-6">
        {resp ? (
          resp.ok ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">
              <div className="mb-2 font-semibold">✅ 已写入仓库，并将触发 GitHub Actions 打包</div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="opacity-70">AppId：</span>
                  <code>{resp.appId}</code>
                </div>
                <div>
                  <span className="opacity-70">模板：</span>
                  <code>{resp.template}</code>
                </div>
                <div className="opacity-70">文件：</div>
                <ul className="max-h-40 list-disc space-y-1 overflow-auto pl-6 text-emerald-100">
                  {resp.files.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code>
                    </li>
                  ))}
                </ul>
              </div>

              <details
                className="mt-3 cursor-pointer select-none text-sm"
                open={openDetail}
                onToggle={(e) => setOpenDetail((e.target as HTMLDetailsElement).open)}
              >
                <summary className="text-emerald-300">影响详情 / Tips</summary>
                <div className="mt-2 space-y-1 text-emerald-100/90">
                  <p>
                    • 构建完成后，可到 <strong>Actions</strong> 下载 APK；或解压 APK
                    查看<code>assets/build_marker.txt</code>。
                  </p>
                  <p>
                    • 若仓库存在历史包名的 <code>MainActivity.java</code>，系统会自动清理（带
                    [skip ci]）。
                  </p>
                </div>
              </details>
            </div>
          ) : (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-200">
              <div className="mb-2 font-semibold">❌ 生成失败</div>
              <div className="text-sm">
                <div className="opacity-80">{resp.error}</div>
                {resp.detail ? (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/30 p-2 text-xs">
                    {typeof resp.detail === 'string'
                      ? resp.detail
                      : JSON.stringify(resp.detail, null, 2)}
                  </pre>
                ) : null}
              </div>
            </div>
          )
        ) : (
          <p className="text-sm text-white/50">
            小提示：构建完成后，下载 CI 产物的 APK；你也可以在 APK 内的{' '}
            <code>assets/build_marker.txt</code> 查看本次 prompt，验证是否为空包。
          </p>
        )}
      </div>

      {/* Secret 提示（可选） */}
      {!API_SECRET && (
        <p className="mt-3 text-xs text-amber-300/80">
          ⚠️ 未检测到 <code>NEXT_PUBLIC_API_SECRET</code>，请在 Vercel「Environment
          Variables」中配置（保持与 <code>API_SECRET</code> 一致）。
        </p>
      )}
    </div>
  );
}
