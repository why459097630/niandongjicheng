'use client';

import { useEffect, useState } from 'react';

function normalizeTemplate(v: string) {
  // 后端 route.ts 期望的是 core/simple/form（它会自动拼成 `${tpl}-template`）
  // 这里把下拉里可能出现的 "core-template" 之类规范为 "core"
  return v.endsWith('-template') ? v.replace(/-template$/, '') : v;
}

export default function BuildPage() {
  const [templates, setTemplates] = useState<string[]>([]);
  const [tpl, setTpl] = useState('core-template');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // 方案 B（允许伴生文件）
  const [allowCompanions, setAllowCompanions] = useState(true);
  // 自然语言需求
  const [requirement, setRequirement] = useState(
    '生成一个牛大郎餐厅的介绍菜品的安卓app，要可以上传照片、编写文字介绍、设置价格，支持暗色和橙色主题'
  );

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/templates', { cache: 'no-store' });
        const j = await r.json();

        // 尝试把后端返回的模板名转成人看的选项（尽量显示成 *-template），
        // 但真正提交给后端前再做一次 normalize。
        const list: string[] = j?.templates || [];
        if (list.length) {
          // 兼容两种返回：['core','simple','form'] 或 ['core-template',...]
          const pretty = list.map((t) => (/-template$/.test(t) ? t : `${t}-template`));
          setTemplates(pretty);
          setTpl(pretty[0]);
        }
      } catch {
        // ignore，使用本地 fallback
      }
    })();
  }, []);

  const onGen = async () => {
    setBusy(true);
    setMsg('Dispatching build...');

    const templateKey = normalizeTemplate(tpl);

    const payload = {
      template: templateKey,       // core/simple/form
      mode: 'B',                   // ✅ 方案B（允许伴生代码）
      allowCompanions,             // ✅ 允许伴生文件
      requirement: requirement || ''
    };

    try {
      const r = await fetch('/api/generate-apk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const t = await r.text().catch(() => '');
        setMsg(`Dispatch failed. ${t || ''}`.trim());
        setBusy(false);
        return;
      }

      setMsg('Build dispatched. Return to Home to watch status.');
    } catch (e: any) {
      setMsg(`Dispatch failed. ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0B1220] text-white px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold">Generate APK</h1>
        <p className="mt-2 text-white/60">
          Choose a template, enter your requirement, and dispatch the build (Mode B, companions allowed).
        </p>

        {/* 自然语言需求 */}
        <div className="mt-6">
          <label className="mb-2 block text-sm text-white/70">Requirement (自然语言需求)</label>
          <textarea
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 outline-none"
            placeholder="比如：生成一个餐厅点餐的安卓App，可以上传图片、编辑文字介绍、设置价格，支持深色模式……"
          />
        </div>

        {/* 模板选择 + 伴生开关 + 触发按钮 */}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            {templates.length ? (
              templates.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))
            ) : (
              <>
                {/* 本地 fallback 选项 */}
                <option value="core-template">core-template</option>
                <option value="form-template">form-template</option>
                <option value="simple-template">simple-template</option>
              </>
            )}
          </select>

          <label className="inline-flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/20 bg-white/10"
              checked={allowCompanions}
              onChange={(e) => setAllowCompanions(e.target.checked)}
            />
            Allow companions (方案B允许伴生文件)
          </label>

          <button
            onClick={onGen}
            disabled={busy}
            className="rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400 disabled:opacity-60"
          >
            {busy ? 'Working...' : 'Generate APK'}
          </button>
        </div>

        {msg && <p className="mt-4 text-sm text-white/70">{msg}</p>}

        <p className="mt-8 text-sm text-white/50">
          Tip: Go back to{' '}
          <a href="/" className="text-indigo-300 underline">Home</a>
          {' '}to watch real-time build status & download links.
        </p>
      </div>
    </main>
  );
}
