'use client';

import { useState, useEffect, useRef } from 'react';

type RunStatus = 'queued' | 'in_progress' | 'completed' | 'unknown';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RunStatus>('unknown');
  const [conclusion, setConclusion] = useState<string | null>(null);
  const [assets, setAssets] = useState<
    { name: string; browser_download_url: string; size?: number }[]
  >([]);
  const [msg, setMsg] = useState<string>('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 简单的“智能模板”选择：可自行扩展
  function pickTemplate(text: string): 'form-template' | 'core-template' | 'simple-template' {
    const t = text.toLowerCase();
    if (/(form|survey|feedback|输入|表单)/.test(t)) return 'form-template';
    if (/(login|auth|settings|tab|list|网络|通知|数据库|复杂)/.test(t)) return 'core-template';
    return 'simple-template';
  }

  async function triggerBuild(template: string) {
    setBusy(true);
    setMsg('Dispatching build...');
    setStatus('queued');
    setConclusion(null);
    setAssets([]);

    const r = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      setBusy(false);
      setMsg(`Failed to dispatch build: ${r.status} ${text}`);
      return;
    }

    setMsg(`Build dispatched with "${template}". Polling status...`);
    startPolling();
  }

  function startPolling() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const r = await fetch('/api/build/status');
        const j = await r.json();
        // 约定：接口若返回 { ok: true, run: { status, conclusion }, ... }
        const s: RunStatus = j?.run?.status || 'unknown';
        setStatus(s);
        const c = j?.run?.conclusion || null;
        setConclusion(c);

        if (s === 'completed') {
          clearIntervalSafe();
          if (c === 'success') {
            setMsg('Build success. Fetching latest release...');
            await fetchLatestRelease();
          } else {
            setMsg('Build failed. Please check GitHub Actions logs.');
          }
          setBusy(false);
        }
      } catch (e) {
        // 忽略短暂网络错误
      }
    }, 4000);
  }

  function clearIntervalSafe() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function fetchLatestRelease() {
    try {
      const r = await fetch('/api/release/latest');
      const j = await r.json();
      const list = j?.assets || [];
      setAssets(list);
      if (!list.length) {
        setMsg('Release ok but no APK assets found.');
      } else {
        setMsg('Ready! Download your APK(s) below.');
      }
    } catch (e) {
      setMsg('Release fetch error.');
    }
  }

  useEffect(() => {
    return () => clearIntervalSafe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tpl = pickTemplate(prompt);
    await triggerBuild(tpl);
  };

  return (
    <main className="min-h-screen bg-[#0B1220] text-white">
      {/* 背景渐变圈 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-200px] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,rgba(99,102,241,0.25)_0%,rgba(99,102,241,0)_60%)]" />
      </div>

      <section className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-6 pt-32 text-center">
        <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-4xl font-extrabold leading-tight text-transparent sm:text-5xl md:text-6xl">
          Build Your App From a Single Prompt
        </h1>
        <p className="mt-6 text-white/70">
          Type your idea and get a ready-to-install APK file in minutes.
        </p>

        <form onSubmit={onSubmit} className="mt-10 w-full">
          <div className="mx-auto flex max-w-2xl gap-3">
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-base text-white placeholder-white/40 outline-none backdrop-blur-md focus:border-indigo-400"
              placeholder="e.g. A meditation timer with sound alert"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-xl bg-indigo-500 px-5 py-4 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Building…' : 'Generate App'}
            </button>
          </div>
          <p className="mt-3 text-sm text-white/50">
            Example: A to-do app with notifications and dark mode
          </p>
        </form>

        {/* 状态与结果 */}
        {(busy || status !== 'unknown' || msg) && (
          <div className="mt-10 w-full max-w-2xl rounded-xl border border-white/10 bg-white/5 p-5 text-left">
            <div className="text-sm text-white/70">Status: <b className="text-white">{status}</b></div>
            {conclusion && (
              <div className="mt-1 text-sm text-white/70">
                Conclusion: <b className="text-white">{conclusion}</b>
              </div>
            )}
            {msg && <div className="mt-2 text-sm text-white/60">{msg}</div>}

            {assets.length > 0 && (
              <div className="mt-5">
                <div className="text-sm text-white/70 mb-2">Download APK:</div>
                <div className="flex flex-wrap gap-2">
                  {assets.map((a: any) => (
                    <a
                      key={a.browser_download_url}
                      href={a.browser_download_url}
                      className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
                    >
                      {a.name}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 text-sm text-white/50">
              Need to choose a template manually?{' '}
              <a href="/build" className="text-indigo-300 underline hover:text-indigo-200">
                Go to Advanced builder
              </a>
              .
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
