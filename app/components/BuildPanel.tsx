'use client';

import { useEffect, useRef, useState } from 'react';

type Run = {
  number: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  url: string;
};

type Asset = { id: number; name: string; size: number; download_url: string };

export default function BuildPanel() {
  const [template, setTemplate] = useState<'core-template'|'simple-template'|'form-template'>('core-template');
  const [run, setRun] = useState<Run | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<NodeJS.Timeout | null>(null);

  async function startBuild() {
    setLoading(true);
    setAssets([]);
    setRun(null);

    const resp = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template })
    });
    const data = await resp.json();
    if (!resp.ok || !data?.ok) {
      setLoading(false);
      alert('触发构建失败');
      return;
    }
    poll(); // 触发后开始轮询
  }

  async function poll() {
    clearInterval(timer.current as any);

    const tick = async () => {
      const r = await fetch('/api/build/status', { cache: 'no-store' }).then(r => r.json());
      if (r?.run) setRun(r.run);

      if (r?.run?.status === 'completed') {
        clearInterval(timer.current as any);
        setLoading(false);

        if (r?.run?.conclusion === 'success') {
          const k = await fetch('/api/release/latest', { cache: 'no-store' }).then(r => r.json());
          setAssets(k?.assets ?? []);
        }
      }
    };

    await tick();
    timer.current = setInterval(tick, 4000); // 每 4s 轮询一次
  }

  useEffect(() => () => clearInterval(timer.current as any), []);

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select
          className="border rounded px-2 py-1"
          value={template}
          onChange={(e) => setTemplate(e.target.value as any)}
        >
          <option value="core-template">core-template</option>
          <option value="simple-template">simple-template</option>
          <option value="form-template">form-template</option>
        </select>
        <button
          className="px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-50"
          onClick={startBuild}
          disabled={loading}
        >
          {loading ? '构建中…' : '生成 APK'}
        </button>
      </div>

      {run && (
        <div className="text-sm">
          <div>Run #{run.number} · status: <b>{run.status}</b> · conclusion: <b>{run.conclusion ?? '-'}</b></div>
          <a className="text-indigo-600 underline" href={run.url} target="_blank">查看 GitHub Actions</a>
        </div>
      )}

      {assets.length > 0 && (
        <div>
          <div className="font-medium mb-2">下载 APK：</div>
          <ul className="list-disc pl-5 space-y-1">
            {assets.map(a => (
              <li key={a.id}>
                <a className="text-indigo-600 underline" href={a.download_url} target="_blank" rel="noreferrer">
                  {a.name}
                </a>
                <span className="text-gray-500 ml-2">
                  ({(a.size / 1024 / 1024).toFixed(2)} MB)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
