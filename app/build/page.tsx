'use client';

import { useEffect, useState } from 'react';

export default function BuildPage() {
  const [templates, setTemplates] = useState<string[]>([]);
  const [tpl, setTpl] = useState('core-template');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/templates');
        const j = await r.json();
        setTemplates(j?.templates || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  const onGen = async () => {
    setBusy(true);
    setMsg('Dispatching build...');
    const r = await fetch('/api/generate-apk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: tpl }),
    });
    if (!r.ok) {
      setBusy(false);
      setMsg('Dispatch failed.');
      return;
    }
    setMsg('Build dispatched. Return to Home to watch status.');
    setBusy(false);
  };

  return (
    <main className="min-h-screen bg-[#0B1220] text-white px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold">Generate APK</h1>
        <p className="mt-2 text-white/60">Choose a template and dispatch the build.</p>

        <div className="mt-8 flex gap-3">
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
                <option value="core-template">core-template</option>
                <option value="form-template">form-template</option>
                <option value="simple-template">simple-template</option>
              </>
            )}
          </select>

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
