'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  dispatchBuild,
  getBuildStatus,
  getLatestRelease,
  type Template,
  type ReleaseAsset,
} from '../lib/client';
import { pickTemplateByText } from '../lib/templates';

type Phase = 'idle' | 'dispatching' | 'polling' | 'success' | 'error';

export default function GeneratePanel() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [prompt, setPrompt] = useState('');
  const [tpl, setTpl] = useState<Template>('core-template');
  const [assets, setAssets] = useState<ReleaseAsset[]>([]);
  const [msg, setMsg] = useState<string>('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const canSubmit = useMemo(() => phase === 'idle' || phase === 'success' || phase === 'error', [phase]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function pollStatus() {
    try {
      setPhase('polling');
      while (true) {
        const r = await getBuildStatus();
        if (r.run.status === 'completed') {
          if (r.run.conclusion === 'success') {
            setPhase('success');
            const rel = await getLatestRelease();
            setAssets(rel.assets ?? []);
            setMsg('Build succeeded!');
          } else {
            setPhase('error');
            setMsg('Build failed.');
          }
          break;
        }
        await new Promise((res) => {
          timerRef.current = setTimeout(res, 5000);
        });
      }
    } catch (e) {
      setPhase('error');
      setMsg('Polling failed.');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const picked = pickTemplateByText(prompt);
    setTpl(picked);

    try {
      setPhase('dispatching');
      setMsg('Dispatching build…');
      await dispatchBuild(picked);
      setMsg('Build dispatched, polling…');
      await pollStatus();
    } catch (err) {
      setPhase('error');
      setMsg('Dispatch failed.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl pt-10 text-center">
      <h1 className="mb-6 text-4xl font-bold">Build Your App From a Single Prompt</h1>

      <form onSubmit={onSubmit} className="mx-auto flex max-w-2xl items-center gap-3">
        <input
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-3 outline-none placeholder-white/40 focus:border-white/30"
          placeholder="e.g. A meditation timer with sound alert"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!canSubmit}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-indigo-500 px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          {phase === 'dispatching' || phase === 'polling' ? 'Building…' : 'Generate App'}
        </button>
      </form>

      <p className="mt-3 text-sm text-white/60">
        Example: A to-do app with notifications and dark mode
      </p>

      {msg && <p className="mt-6 text-white/80">{msg}</p>}

      {phase === 'success' && assets.length > 0 && (
        <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-white/10 bg-white/5 p-4 text-left">
          <h2 className="mb-2 text-lg font-semibold">Download</h2>
          <ul className="list-disc pl-5">
            {assets.map((a) => (
              <li key={a.id} className="py-1">
                <a href={a.browser_download_url} className="text-indigo-300 hover:underline">
                  {a.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
