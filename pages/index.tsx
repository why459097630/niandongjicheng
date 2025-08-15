// pages/index.tsx 里（示例逻辑，按你的组件结构放到合适位置）
import { useState } from 'react';

export default function Home() {
  const [template, setTemplate] = useState<'core-template'|'simple-template'|'form-template'>('core-template');
  const [status, setStatus] = useState<'idle'|'building'|'success'|'failed'>('idle');
  const [links, setLinks] = useState<{name:string,url:string,sha256?:string}[]>([]);
  const [msg, setMsg] = useState<string>('');

  async function startBuild() {
    setStatus('building');
    setMsg('Dispatching build...');
    setLinks([]);

    // 1) 触发构建
    const r = await fetch('/api/build', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ template })
    });
    if (!r.ok) { setStatus('failed'); setMsg('Failed to dispatch build'); return; }

    // 2) 轮询状态
    for (let i=0;i<120;i++) { // 最多轮询 10 分钟（120*5s）
      const s = await fetch('/api/build/status').then(res=>res.json());
      // 期望：{ ok:true, run:{ status:'queued'|'in_progress'|'completed', conclusion:'success'|'failure'|... } }
      setMsg(`Build status: ${s?.run?.status || 'unknown'}`);
      if (s?.run?.status === 'completed') {
        if (s?.run?.conclusion === 'success') {
          setStatus('success');
          break;
        } else {
          setStatus('failed');
          return;
        }
      }
      await new Promise(r => setTimeout(r, 5000));
    }

    // 3) 拉取 Release 最新 APK
    const rel = await fetch('/api/release/latest').then(res=>res.json());
    // 期望：{ ok:true, assets:[{name,url,sha256?}, ...] }
    if (rel?.ok && Array.isArray(rel.assets)) {
      setLinks(rel.assets);
      setMsg('Ready to download.');
    } else {
      setMsg('Cannot fetch latest release.');
      setStatus('failed');
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      {/* 你的漂亮 UI 保留，这里只演示控制区 */}
      <div className="mt-6 flex items-center gap-3">
        <select
          value={template}
          onChange={e=>setTemplate(e.target.value as any)}
          className="input"
        >
          <option value="core-template">core-template</option>
          <option value="simple-template">simple-template</option>
          <option value="form-template">form-template</option>
        </select>

        <button className="btn-primary" disabled={status==='building'} onClick={startBuild}>
          {status==='building' ? 'Building...' : 'Generate App'}
        </button>
      </div>

      <p className="helper-text mt-4">{msg}</p>

      {status==='success' && links.length>0 && (
        <div className="mt-6 w-full max-w-xl space-y-3">
          {links.map(a => (
            <div key={a.url} className="flex items-center justify-between rounded-lg bg-slate-800/50 border border-slate-700/60 px-4 py-3">
              <div className="truncate">
                <div className="font-medium">{a.name}</div>
                {a.sha256 && <div className="text-xs text-slate-400 truncate">sha256: {a.sha256}</div>}
              </div>
              <a className="btn-primary px-4 py-2" href={a.url} target="_blank" rel="noreferrer">Download</a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
