import React, { useMemo, useState } from 'react';

type ApiOk = {
  ok: true;
  appId: string;
  template: string;
  files: { path: string; sha?: string }[];
};
type ApiFail = { ok: false; error: string; detail?: any };

const API_SECRET = process.env.NEXT_PUBLIC_API_SECRET || '';

const TEMPLATE_OPTIONS = [
  { value: 'timer', label: '倒计时 / Timer' },
  { value: 'todo', label: '待办清单 / Todo' },
  { value: 'webview', label: '网页 / WebView' },
  // 如果你想给用户更多选项，后端已支持：counter / note / hello
  // { value: 'counter', label: '计数器 / Counter' },
  // { value: 'note', label: '笔记 / Note' },
  // { value: 'hello', label: 'Hello 模板（极简）' },
];

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<string>(''); // 必选：默认空
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiOk | ApiFail | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const canSubmit = useMemo(() => {
    return !loading && prompt.trim().length > 0 && template.trim().length > 0;
  }, [loading, prompt, template]);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setResp(null);
    try {
      const r = await fetch('/api/generate-apk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': API_SECRET,
        },
        body: JSON.stringify({ prompt, template }), // 传入用户选择的模板
      });
      const j = (await r.json()) as ApiOk | ApiFail;
      setResp(j);
    } catch (e: any) {
      setResp({ ok: false, error: String(e?.message || e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6 rounded-xl bg-[#1A2237] text-white shadow-lg">
      <h2 className="text-2xl font-bold mb-4">一键生成 APK</h2>

      {/* 提示语 */}
      <p className="text-sm text-white/70 mb-4">
        输入需求，<b>并从下方下拉框选择模板</b>，点击按钮即可将代码写入仓库并触发 CI。
      </p>

      {/* prompt */}
      <label className="block text-sm mb-2">需求描述（prompt）</label>
      <textarea
        className="w-full rounded-lg bg-[#0D1324] border border-white/10 outline-none p-3 placeholder:text-white/30"
        rows={5}
        placeholder="例如：倒计时 10 秒；或：打开 https://example.com 的网页；或：待办清单应用…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* 模板选择（不提供“自动选择”） */}
      <label className="block text-sm mt-4 mb-2">模板（必须选择）</label>
      <select
        className="w-full rounded-lg bg-[#0D1324] border border-white/10 outline-none p-3"
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
      >
        <option value="" disabled>
          请选择一个模板…
        </option>
        {TEMPLATE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* 提示：不同模板的输入建议 */}
      <div className="text-xs text-white/60 mt-2 space-y-1">
        <div>• WebView：建议在 prompt 里包含一个 URL（如 https://example.com）。</div>
        <div>• Timer：可以在 prompt 里写秒数（如 “倒计时 10 秒”），不写默认 60 秒。</div>
      </div>

      {/* 按钮 */}
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className={`mt-6 w-full py-3 rounded-lg font-semibold ${
          canSubmit ? 'bg-[#5B8CFF] hover:bg-[#4A7EEA]' : 'bg-white/10 cursor-not-allowed'
        }`}
      >
        {loading ? '生成中…' : 'Generate APK'}
      </button>

      {/* 结果 */}
      {resp && (
        <div className="mt-6">
          {resp.ok ? (
            <div className="bg-[#0F1830] border border-[#254] rounded-lg p-4">
              <div className="text-green-400 font-semibold mb-2">✅ 已写入仓库，并将触发 GitHub Actions 打包</div>
              <div className="text-sm whitespace-pre-wrap leading-7">
                <div>AppId：{resp.appId}</div>
                <div>模板：{resp.template}</div>
                <div className="mt-2">文件：</div>
                <ul className="list-disc pl-6">
                  {resp.files.map((f) => (
                    <li key={f.path} className="font-mono text-xs">{f.path}</li>
                  ))}
                </ul>
              </div>

              {/* 影响详情 */}
              <button
                className="mt-3 text-xs underline text-white/70"
                onClick={() => setShowDetail((s) => !s)}
              >
                {showDetail ? '收起详情' : '影响详情'}
              </button>
              {showDetail && (
                <div className="text-xs text-white/70 mt-2">
                  小贴士：构建完成后，下载 CI 产物的 APK；你也可以在 APK 内的
                  <code className="mx-1">assets/build_marker.txt</code>
                  查看本次 prompt 验证是否生效。
                </div>
              )}
            </div>
          ) : (
            <div className="bg-[#2A1220] border border-[#633] rounded-lg p-4">
              <div className="text-red-400 font-semibold mb-2">❌ 生成失败</div>
              <div className="text-sm">
                <div className="font-mono">{resp.error}</div>
                {resp.detail && <pre className="mt-2 text-xs opacity-80">{JSON.stringify(resp.detail, null, 2)}</pre>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
