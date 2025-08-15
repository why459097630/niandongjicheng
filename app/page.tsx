'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
// 轻量规则：根据自然语言做“智能默认”模板
import { pickTemplateByText, type Template } from '../pages/api/_lib/pickTemplateByText';

type BuildStatus =
  | 'idle'
  | 'dispatching'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'error';

type GHRun = {
  status?: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | null;
};

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template>('core-template');

  // 是否手动覆盖（true 时不再随 prompt 自动切换）
  const [manualOverride, setManualOverride] = useState(false);

  // 构造一个“智能推荐”
  const smartPick = useMemo<Template>(() => pickTemplateByText(prompt), [prompt]);

  // 后端构建状态
  const [status, setStatus] = useState<BuildStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [tag, setTag] = useState<string>('');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 拉取可用模板
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/templates', { cache: 'no-store' });
        const j = await r.json();
        if (j?.ok && Array.isArray(j.templates)) {
          setTemplates(j.templates as Template[]);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // 如果没有手动覆盖，就让当前选择跟随“智能推荐”
  useEffect(() => {
    if (!manualOverride) {
      setSelected(smartPick);
    }
  }, [smartPick, manualOverride]);

  // 触发构建
  const onGenerate = async () => {
    setStatus('dispatching');
    setMessage('Dispatching build…');

    try {
      const r = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ template: selected, prompt }),
      });
      const j = await r.json();

      if (!j?.ok) {
        setStatus('error');
        setMessage(j?.error || 'Failed to dispatch build.');
        return;
      }

      setMessage(`Build dispatched for ${selected}. Polling status…`);
      startPolling();
    } catch (err) {
      setStatus('error');
      setMessage('Network error while dispatching build.');
    }
  };

  // 轮询 /api/build/status，最多 ~5 分钟（60 次 * 5s）
  const startPolling = () => {
    setStatus('queued');
    let times = 0;

    const tick = async () => {
      try {
        const r = await fetch('/api/build/status', { cache: 'no-store' });
        const j: { ok?: boolean; run?: GHRun } = await r.json();
        if (!j?.ok) throw new Error('bad status');

        const run = j.run || {};
        if (run.status === 'in_progress') {
          setStatus('in_progress');
          setMessage('Building…');
        } else if (run.status === 'queued') {
          setStatus('queued');
          setMessage('Queued…');
        } else if (run.status === 'completed') {
          // 完成
          if (run.conclusion === 'success') {
            setStatus('completed');
            setMessage('Build succeeded. Fetching latest release…');
            clearPolling();
            await fetchLatest();
            return;
          }
          setStatus('error');
          setMessage(`Build failed (${run.conclusion}).`);
          clearPolling();
          return;
        }
      } catch {
        setMessage('Polling… (temporary error, will retry)');
      }

      times += 1;
      if (times > 60) {
        setStatus('error');
        setMessage('Timeout waiting for build result.');
        clearPolling();
        return;
      }
    };

    tick();
    pollingRef.current = setInterval(tick, 5000);
  };

  const clearPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  // 获取最新 Release 的 apk 下载链接
  const fetchLatest = async () => {
    try {
      const r = await fetch('/api/release/latest', { cache: 'no-store' });
      const j = await r.json();
      if (j?.ok) {
        setTag(j.tag || '');
        setAssets(Array.isArray(j.assets) ? j.assets : []);
        if (!j.assets?.length) {
          setMessage('Build finished, but no downloadable assets were found.');
        } else {
          setMessage('Done.');
        }
      } else {
        setMessage('Failed to fetch latest release.');
      }
    } catch {
      setMessage('Failed to fetch latest release.');
    }
  };

  // 切回“智能默认”
  const resetToSmart = () => {
    setManualOverride(false);
    setSelected(smartPick);
  };

  // 手动选择模板
  const onSelect = (t: Template) => {
    setManualOverride(true);
    setSelected(t);
  };

  return (
    <main className="min-h-screen text-slate-100">
      {/* 背景光斑已在 globals.css 配好 */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-14 text-center">
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight">
          <span className="block">Build Your App From a</span>
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 to-purple-300">
            Single Prompt
          </span>
        </h1>

        <p className="mt-6 text-slate-300">
          Type your idea and get a ready-to-install APK file in minutes.
        </p>

        {/* 输入 + 下拉 + 按钮 */}
        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center items-center">
          <input
            className="w-full sm:w-[540px] h-12 rounded-xl bg-slate-900/50 ring-1 ring-white/10 px-4 outline-none focus:ring-2 focus:ring-indigo-400/60 placeholder:text-slate-400"
            placeholder="e.g. A meditation timer with sound alert"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <select
              className="h-12 rounded-xl bg-slate-900/50 ring-1 ring-white/10 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400/60"
              value={selected}
              onChange={(e) => onSelect(e.target.value as Template)}
            >
              {templates.length
                ? templates.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))
                : (['core-template', 'simple-template', 'form-template'] as Template[]).map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ),
                  )}
            </select>

            {manualOverride ? (
              <button
                onClick={resetToSmart}
                className="h-12 px-3 rounded-xl text-xs ring-1 ring-white/10 hover:ring-indigo-400/60 hover:bg-slate-900/40 transition"
                title={`Smart pick: ${smartPick}`}
              >
                Use Smart
              </button>
            ) : (
              <div
                className="h-12 px-3 rounded-xl text-xs flex items-center ring-1 ring-white/10 bg-slate-900/40"
                title="Following smart pick"
              >
                Smart: <span className="ml-1 font-mono">{smartPick}</span>
              </div>
            )}
          </div>

          <button
            onClick={onGenerate}
            disabled={status === 'dispatching' || status === 'queued' || status === 'in_progress'}
            className="h-12 px-6 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20 disabled:opacity-50"
          >
            {status === 'dispatching' || status === 'queued' || status === 'in_progress'
              ? 'Generating…'
              : 'Generate App'}
          </button>
        </div>

        {/* 说明 */}
        <p className="mt-3 text-sm text-slate-400">
          Example: A to-do app with notifications and dark mode
        </p>

        {/* 状态条 */}
        <div className="mt-8 text-sm text-slate-300">
          {status !== 'idle' && (
            <div className="inline-flex items-center gap-2 rounded-xl bg-slate-900/40 ring-1 ring-white/10 px-3 py-2">
              <span
                className={
                  status === 'error'
                    ? 'inline-block w-2 h-2 rounded-full bg-rose-400'
                    : status === 'completed'
                    ? 'inline-block w-2 h-2 rounded-full bg-emerald-400'
                    : 'inline-block w-2 h-2 rounded-full bg-amber-300'
                }
              />
              <span className="font-medium capitalize">{status}</span>
              <span className="text-slate-400">— {message}</span>
            </div>
          )}
        </div>

        {/* 构建结果（下载链接） */}
        {tag && (
          <div className="mt-10 mx-auto max-w-3xl text-left">
            <h3 className="text-lg font-semibold">
              Latest Release: <span className="font-mono">{tag}</span>
            </h3>
            {!assets.length ? (
              <p className="mt-2 text-slate-400">
                No downloadable assets were found. (If this is a brand-new run, give GitHub
                a few more seconds and refresh.)
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {assets.map((a) => (
                  <li key={a.browser_download_url}>
                    <a
                      href={a.browser_download_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg ring-1 ring-white/10 hover:ring-indigo-400/60 hover:bg-slate-900/40 transition"
                    >
                      <span className="font-mono">{a.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
