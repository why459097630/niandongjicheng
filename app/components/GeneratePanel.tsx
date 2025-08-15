'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { dispatchBuild, getBuildStatus, getLatestRelease, type Template, type ReleaseAsset } from '@/lib/client';
import { pickTemplateByText } from '@/lib/templates';

type Phase = 'idle' | 'dispatching' | 'polling' | 'success' | 'error';

const RELEASES_URL =
  process.env.NEXT_PUBLIC_REPO_RELEASES ||
  'https://github.com/why459097630/Packaging-warehouse/releases';

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string>('');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [tag, setTag] = useState<string>('');

  const template: Template = useMemo(() => pickTemplateByText(prompt), [prompt]);

  // 触发构建
  async function onGenerate() {
    try {
      setPhase('dispatching');
      setMessage('Submitting build job...');
      setAssets([]);
      setTag('');

      await dispatchBuild(template);

      setPhase('polling');
      setMessage('Build queued…');

      // 轮询（最长 5 分钟，指数回退 2s → 20s）
      const started = Date.now();
      let backoff = 2000;

      // 每次进度说明
      function statusTip(s: string, c?: string) {
        if (s === 'queued') return 'Build queued…';
        if (s === 'in_progress') return 'Building…';
        if (s === 'completed') return c === 'success' ? 'Build finished!' : `Build ${c}`;
        return s;
      }

      while (Date.now() - started < 5 * 60 * 1000) {
        const st = await getBuildStatus();
        setMessage(statusTip(st.run.status, st.run.conclusion));

        if (st.run.status === 'completed') {
          if (st.run.conclusion === 'success') {
            // 拉取最新 release
            const rel = await getLatestRelease();
            setTag(rel.tag);
            setAssets(rel.assets || []);
            setPhase('success');
          } else {
            setPhase('error');
            setMessage(`Build ${st.run.conclusion || 'failed'}`);
          }
          return;
        }

        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 1.6, 20_000);
      }

      setPhase('error');
      setMessage('Build timeout, please try again later.');
    } catch (e: any) {
      setPhase('error');
      setMessage(e?.message || 'Unexpected error');
    }
  }

  const disabled = phase === 'dispatching' || phase === 'polling';

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center space-y-4">
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">
          Build Your App From a <span className="text-indigo-300">Single Prompt</span>
        </h1>

        <p className="text-slate-300">
          Type your idea and get a ready-to-install APK file in minutes.
        </p>

        <div className="flex gap-3 mt-6">
          <input
            className="flex-1 rounded-xl bg-slate-900/60 border border-slate-700 px-4 py-3 text-slate-100
                       placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. A to-do app with notifications and dark mode"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
          <button
            onClick={onGenerate}
            disabled={disabled}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60
                       text-white font-semibold transition-colors"
            aria-busy={disabled}
          >
            {phase === 'dispatching' || phase === 'polling' ? 'Generating…' : 'Generate App'}
          </button>
        </div>

        {/* 模板提示 */}
        <p className="text-sm text-slate-400">
          Using template: <span className="font-mono text-slate-200">{template}</span>
        </p>

        {/* 状态与下载区 */}
        <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900/40 p-5 text-left">
          {phase === 'idle' && (
            <p className="text-slate-400">Click “Generate App” to start a build.</p>
          )}

          {(phase === 'dispatching' || phase === 'polling') && (
            <div className="space-y-2">
              <p className="text-slate-200">{message}</p>
              <p className="text-slate-500 text-sm">
                This usually takes 1–3 minutes. Please keep this tab open.
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <p className="text-rose-300 font-medium">{message}</p>
              <div className="flex gap-3">
                <button
                  onClick={onGenerate}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100"
                >
                  Retry
                </button>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  View GitHub Releases
                </a>
              </div>
            </div>
          )}

          {phase === 'success' && (
            <div className="space-y-4">
              <p className="text-emerald-300 font-medium">
                ✅ Build Success {tag ? `(${tag})` : ''}
              </p>
              {assets?.length > 0 ? (
                <ul className="space-y-2">
                  {assets.map((a) => (
                    <li key={a.browser_download_url} className="flex items-center justify-between">
                      <span className="text-slate-200">{a.name}</span>
                      <a
                        className="text-indigo-300 hover:text-indigo-200 underline underline-offset-4"
                        href={a.browser_download_url}
                        target="_blank"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-2">
                  <p className="text-slate-300">
                    Build finished but no release asset is attached yet.
                  </p>
                  <a
                    href={RELEASES_URL}
                    target="_blank"
                    className="text-indigo-300 hover:text-indigo-200 underline underline-offset-4"
                  >
                    Check GitHub Releases
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 说明 */}
        <p className="text-xs text-slate-500 mt-4">
          Example: A to-do app with notifications and dark mode
        </p>
      </div>
    </div>
  );
}
