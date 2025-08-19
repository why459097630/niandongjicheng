// app/components/GeneratePanel.tsx
'use client';

import React, { useMemo, useState } from 'react';

type GenResult =
  | { ok: true; message: string; detail?: any }
  | { ok: false; message: string; detail?: any };

const TEMPLATES = [
  { key: 'core-template', label: 'Core 模板（core-template）' },
  { key: 'form-template', label: 'Form 模板（form-template）' },
  { key: 'simple-template', label: 'Simple 模板（simple-template）' },
];

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<string>(TEMPLATES[1].key); // 默认 form-template
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);

  // 方案A：把密钥从公开环境变量里读出来，随请求发送
  const apiSecret = useMemo(
    () => (process.env.NEXT_PUBLIC_API_SECRET ?? '').trim(),
    []
  );

  async function handleGenerate() {
    setResult(null);

    if (!prompt.trim()) {
      setResult({ ok: false, message: '请填写需求（prompt）' });
      return;
    }
    if (!template) {
      setResult({ ok: false, message: '请选择一个模板' });
      return;
    }

    // 没配密钥也允许继续，但提示一下（请求会被 401）
    if (!apiSecret) {
      setResult({
        ok: false,
        message:
          '未检测到 NEXT_PUBLIC_API_SECRET，请在 Vercel 或 .env.local 中配置',
      });
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch('/api/generate-apk', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 关键改动：把密钥放到请求头（临时方案，用于打通链路）
          'x-api-secret': apiSecret,
        },
        body: JSON.stringify({ prompt, template }),
      });

      const text = await resp.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* 不是 JSON 就当文本看 */
      }

      if (!resp.ok) {
        setResult({
          ok: false,
          message: `生成失败: ${resp.status} ${resp.statusText}`,
          detail: data ?? text,
        });
        return;
      }

      setResult({
        ok: true,
        message: '已写入仓库并触发 GitHub Actions 打包',
        detail: data ?? text,
      });
    } catch (e: any) {
      setResult({ ok: false, message: e?.message ?? '请求异常', detail: e });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-2xl bg-slate-900/60 p-6 text-slate-100">
      <h2 className="mb-4 text-2xl font-bold">一键生成 APK</h2>

      <label className="mb-2 block text-sm opacity-80">需求描述（prompt）</label>
      <textarea
        className="mb-4 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
        rows={6}
        placeholder="生成一个介绍法拉利历史上所有车型的安卓app，要求有图片和文字介绍"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <label className="mb-2 block text-sm opacity-80">模板</label>
      <select
        className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
      >
        {TEMPLATES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>

      <button
        disabled={loading}
        onClick={handleGenerate}
        className="w-full rounded-lg bg-indigo-600 p-3 font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? '生成中…' : 'Generate APK'}
      </button>

      {result && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            result.ok
              ? 'border-emerald-600/40 bg-emerald-900/20'
              : 'border-rose-600/40 bg-rose-900/20'
          }`}
        >
          <div className="font-semibold">{result.message}</div>
          {result.detail ? (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs opacity-90">
              {typeof result.detail === 'string'
                ? result.detail
                : JSON.stringify(result.detail, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      {/* 小提示：密钥状态 */}
      <div className="mt-3 text-xs opacity-60">
        前端密钥状态：{apiSecret ? '已读取' : '未配置（将导致 401）'}
      </div>
    </div>
  );
}
