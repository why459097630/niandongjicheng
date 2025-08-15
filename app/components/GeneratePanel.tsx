'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { pickTemplateByText, type Template } from '@/lib/pickTemplate';
import { dispatchBuild, getBuildStatus, getLatestRelease, sleep, type ReleaseAsset } from '@/lib/api';

type Phase = 'idle' | 'dispatching' | 'polling' | 'success' | 'error';

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('');
  const smartDefault = useMemo<Template>(() => pickTemplateByText(prompt), [prompt]);
  const [overrideTpl, setOverrideTpl] = useState<Template | ''>('');
  const chosen = (overrideTpl || smartDefault) as Template;

  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const abortRef = useRef(false);

  useEffect(() => {
    return () => { abortRef.current = true; };
  }, []);

  async function handleGenerate() {
    setAssets([]);
    setPhase('dispatching');
    setMessage('Dispatching…');

    try {
      // 1) 触发构建
      await dispatchBuild(chosen);

      // 2) 轮询构建状态（最多 10 分钟，5s 一次）
      setPhase('polling');
      for (let i = 0; i < 120; i++) {
        if (abortRef.current) return;
        const s = await getBuildStatus();
        setMessage(`Status: ${s.run.status} ${s.run.conclusion ? `/ ${s.run.conclusion}` : ''}`);
        if (s.run.status === 'completed') {
          if (s.run.conclusion !== 'success') {
            throw new Error(`Build ${s.run.conclusion}`);
          }
          break;
        }
        await sleep(5000);
      }

      // 3) 拿最新 Release 的 3 个 APK 下载
      const rel = await getLatestRelease();
      if (!Array.isArray(rel.assets) || rel.assets.length === 0) {
        throw new Error('No APK assets found in latest release');
      }
      setAssets(rel.assets);
      setPhase('success');
      setMessage(`Ready! tag: ${rel.tag}`);
    } catch (err: any) {
      setPhase('error');
      setMessage(err?.message || 'Unknown error');
    }
  }

  const busy = phase === 'dispatching' || phase === 'polling';

  return (
    <div className="mx-auto max-w-3xl w-full px-4 py-10">
      {/* 输入 + 选择模板 */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
        <input
          className="flex-1 rounded-lg px-4 py-3 bg-zinc-900/50 text-zinc-100 border border-zinc-800 outline-none"
          placeholder="e.g. A to-do app with notifications and dark mode"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
        <select
          value={overrideTpl}
          onChange={e => setOverrideTpl((e.target.value || '') as Template | '')}
          className="rounded-lg px-3 py-3 bg-zinc-900/50 text-zinc-100 border border-zinc-800"
          title="模板：智能默认 + 可手动覆盖"
        >
          <option value="">智能默认（{smartDefault}）</option>
          <option value="core-template">core-template</option>
          <option value="simple-template">simple-template</option>
          <option value="form-template">form-template</option>
        </select>
        <button
          onClick={handleGenerate}
          disabled={busy}
          className={`rounded-xl px-5 py-3 font-medium ${busy ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-90'} bg-indigo-600 text-white`}
        >
          {busy ? 'Generating…' : 'Generate App'}
        </button>
      </div>

      {/* 状态提示 */}
      {phase !== 'idle' && (
        <p className="mt-4 text-sm text-zinc-400">
          {message}
        </p>
      )}

      {/* 下载列表 */}
      {phase === 'success' && assets.length > 0 && (
        <div className="mt-6 grid md:grid-cols-3 gap-3">
          {assets.map(a => (
            <a
              key={a.browser_download_url}
              href={a.browser_download_url}
              className="border border-zinc-800 rounded-xl p-4 hover:bg-zinc-900/40"
              target="_blank"
              rel="noreferrer"
            >
              <div className="text-zinc-100 text-sm font-medium truncate">{a.name}</div>
              <div className="text-xs text-zinc-500 truncate">{a.browser_download_url}</div>
            </a>
          ))}
        </div>
      )}

      {/* 错误提示 */}
      {phase === 'error' && (
        <div className="mt-4 text-sm text-red-400">
          {message}
        </div>
      )}
    </div>
  );
}
