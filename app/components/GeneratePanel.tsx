'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { pickTemplateByText, type Template } from '../lib/pickTemplate';
import {
  dispatchBuild,
  getBuildStatus,
  getLatestRelease,
  sleep,
  type ReleaseAsset,
} from '../lib/api';

type Phase = 'idle' | 'dispatching' | 'polling' | 'success' | 'error';

const POLL_INTERVAL = 3000;        // 轮询间隔 3s
const POLL_TIMEOUT = 5 * 60 * 1000; // 最长轮询 5 分钟

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [msg, setMsg] = useState<string>('');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const isBusy = phase === 'dispatching' || phase === 'polling';

  // 实时给出将采用的模板（用户也可以在后续页手动覆盖）
  const template: Template = useMemo(
    () => pickTemplateByText(prompt),
    [prompt],
  );

  const onGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setMsg('');
    setAssets([]);

    try {
      setPhase('dispatching');

      // 1) 触发一次构建
      await dispatchBuild({ template, prompt });

      // 2) 轮询构建状态（成功/失败/超时）
      setPhase('polling');
      const start = Date.now();

      while (Date.now() - start < POLL_TIMEOUT) {
        const s = await getBuildStatus(); // { run: { status, conclusion } }
        const status = s?.run?.status;
        const conclusion = s?.run?.conclusion;

        if (status === 'completed') {
          if (conclusion === 'success') {
            setPhase('success');
          } else {
            setPhase('error');
            setMsg('Build failed.');
          }
          break;
        }
        await sleep(POLL_INTERVAL);
      }

      if (phase !== 'success' && Date.now() - start >= POLL_TIMEOUT) {
        setPhase('error');
        setMsg('Build timed out. Please retry later.');
        return;
      }

      // 3) 拉取最新 Release，给出下载链接
      const r = await getLatestRelease(); // { tag, assets: [...] }
      setAssets((r?.assets ?? []) as ReleaseAsset[]);
    } catch (err: any) {
      setPhase('error');
      setMsg(err?.message || 'Unexpected error.');
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <form onSubmit={onGenerate} className="flex items-center gap-3">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A meditation timer with sound alert"
          className="flex-1 h-12 rounded-lg bg-[#0f172a]/40 border border-white/10 px-4 outline-none"
        />
        <button
          type="submit"
          disabled={isBusy}
          className="h-12 px-5 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          {isBusy ? 'Generating…' : 'Generate App'}
        </button>
      </form>

      {/* 模板提示 */}
      <p className="text-sm text-white/60 mt-3">
        Will use template: <span className="text-white">{template}</span>
      </p>

      {/* 状态区 */}
      <div className="mt-6 text-sm">
        {phase === 'dispatching' && (
          <p className="text-white/70">Dispatching build…</p>
        )}
        {phase === 'polling' && (
          <p className="text-white/70">Building (polling status)…</p>
        )}
        {phase === 'error' && (
          <p className="text-red-400">{msg || 'Build failed.'}</p>
        )}
      </div>

      {/* 成功后展示下载地址 */}
      {phase === 'success' && (
        <div className="mt-8">
          <h3 className="text-white font-medium mb-3">Downloads</h3>
          {assets.length === 0 ? (
            <p className="text-white/60 text-sm">No assets found.</p>
          ) : (
            <ul className="space-y-2">
              {assets.map((a) => (
                <li key={a.browser_download_url}>
                  <a
                    href={a.browser_download_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 underline"
                  >
                    {a.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
