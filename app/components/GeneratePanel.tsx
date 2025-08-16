'use client';
import React, { useCallback, useMemo, useRef, useState } from 'react';

// 这里假设你已有的“生成代码并推送到 GitHub”的 API 路径为 /api/push-to-github
// 要求该接口返回 { ok: true, commitSha: string, message?: string }

const POLL_INTERVAL = 5000; // 5s

type BuildPhase = 'idle' | 'generating' | 'dispatching' | 'queued' | 'building' | 'publishing' | 'success' | 'failure';

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<BuildPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const timerRef = useRef<any>(null);

  const phaseText = useMemo(() => {
    switch (phase) {
      case 'generating':
        return '正在生成代码并推送到仓库…';
      case 'dispatching':
        return '正在触发构建…';
      case 'queued':
        return '已排队，等待可用的构建机器…';
      case 'building':
        return '构建中（编译、打包、签名）…';
      case 'publishing':
        return '发布产物到 Release…';
      case 'success':
        return '构建成功！';
      case 'failure':
        return '构建失败';
      default:
        return '';
    }
  }, [phase]);

  const mapError = (raw?: string) => {
    const s = (raw || '').toLowerCase();
    if (s.includes('rate_limit')) return '请求过于频繁，请稍后重试（已限流）。';
    if (s.includes('no space left')) return '构建环境磁盘不足，已自动释放资源，请重试。';
    if (s.includes('could not resolve all files')) return '依赖下载失败（网络波动），点击重试即可。';
    if (s.includes('execution failed for task :app:packagerelease')) return '打包/签名失败，请检查模板签名配置或改用另一模板。';
    return '构建失败，请重试或更换模板。';
  };

  const pollStatus = useCallback(async (rid: number) => {
    if (!rid) return;
    try {
      const r = await fetch(`/api/build/status/${rid}`).then((r) => r.json());
      if (!r.ok) throw new Error(r.error || 'UNKNOWN');

      if (r.status === 'queued') setPhase('queued');
      else if (r.status === 'in_progress') setPhase('building');
      else if (r.status === 'completed' && r.conclusion === 'success') {
        setPhase('success');
        setDownloadUrl(r.downloadUrl);
        timerRef.current && clearTimeout(timerRef.current);
        return;
      } else if (r.status === 'completed' && r.conclusion !== 'success') {
        setPhase('failure');
        setError(mapError(r.conclusion));
        timerRef.current && clearTimeout(timerRef.current);
        return;
      }

      timerRef.current = setTimeout(() => pollStatus(rid), POLL_INTERVAL);
    } catch (e: any) {
      setPhase('failure');
      setError(mapError(e?.message));
    }
  }, []);

  const onGenerate = useCallback(async () => {
    setPhase('generating');
    setError(null);
    setDownloadUrl(null);
    setRunId(null);

    try {
      // 1) 生成代码并推送到仓库（要求返回 commitSha）
      const push = await fetch('/api/push-to-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      }).then((r) => r.json());

      if (!push.ok) throw new Error(push.error || 'PUSH_FAIL');
      const commitSha: string | undefined = push.commitSha;

      setPhase('dispatching');

      // 2) 通过 commitSha 找到对应 runId
      let runIdLocal: number | null = null;
      if (commitSha) {
        const run = await fetch(`/api/build/run-by-sha?sha=${commitSha}`).then((r) => r.json());
        if (run.ok && run.runId) {
          runIdLocal = run.runId;
          setRunId(runIdLocal);
        }
      }

      if (!runIdLocal) {
        // 兜底：给 GitHub 反应时间，再尝试一次（避免竞态）
        await new Promise((r) => setTimeout(r, 4000));
        if (commitSha) {
          const run = await fetch(`/api/build/run-by-sha?sha=${commitSha}`).then((r) => r.json());
          if (run.ok && run.runId) {
            runIdLocal = run.runId;
            setRunId(runIdLocal);
          }
        }
      }

      if (!runIdLocal) throw new Error('RUN_NOT_FOUND');

      // 3) 轮询状态
      setPhase('queued');
      pollStatus(runIdLocal);
    } catch (e: any) {
      setPhase('failure');
      setError(mapError(e?.message));
    }
  }, [prompt, pollStatus]);

  const onRetry = useCallback(() => {
    onGenerate();
  }, [onGenerate]);

  return (
    <div className="w-full max-w-2xl mx-auto p-6 rounded-2xl shadow bg-white/5 backdrop-blur">
      <h2 className="text-xl font-semibold mb-3 text-white">Build Your App From a Single Prompt</h2>
      <div className="flex gap-2">
        <input
          className="flex-1 px-3 py-2 rounded-xl bg-white/10 text-white outline-none"
          placeholder="e.g. a meditation timer with sound"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          onClick={onGenerate}
          className="px-4 py-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50"
          disabled={!prompt || phase === 'generating' || phase === 'queued' || phase === 'building' || phase === 'publishing'}
        >
          Generate APK
        </button>
      </div>

      {phase !== 'idle' && (
        <div className="mt-4 text-sm text-white/80">
          <div>状态：{phaseText}</div>
          {runId && <div className="mt-1 opacity-70">Run ID：{runId}</div>}
        </div>
      )}

      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          className="inline-block mt-4 px-4 py-2 rounded-xl bg-emerald-600 text-white"
        >
          下载 APK（Release 页面）
        </a>
      )}

      {phase === 'failure' && (
        <div className="mt-4 p-3 rounded-xl bg-red-500/20 text-red-200">
          <div className="font-medium mb-2">构建失败</div>
          <div className="text-sm">{error || '请重试或更换模板。'}</div>
          <div className="mt-3 flex gap-2">
            <button onClick={onRetry} className="px-3 py-1.5 rounded-lg bg-white/10 text-white">重试一次</button>
            <button
              onClick={() => navigator.clipboard.writeText(`runId=${runId} error=${error || ''}`)}
              className="px-3 py-1.5 rounded-lg bg-white/10 text-white"
            >
              复制错误详情
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
