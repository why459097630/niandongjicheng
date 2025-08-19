"use client";

import { useState } from "react";

type ApiOk = {
  ok: true;
  appId: string;
  template: string;
  files: { path: string; sha?: string }[];
};

type ApiFail = { ok: false; error: string; detail?: string };

type ApiResp = ApiOk | ApiFail;

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState<"auto" | "timer" | "todo" | "webview">("auto");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [resp, setResp] = useState<ApiResp | null>(null);

  const apiSecret = process.env.NEXT_PUBLIC_API_SECRET || "";

  async function handleGenerate() {
    setLoading(true);
    setMessage("正在生成代码并触发打包…");
    setResp(null);

    try {
      const body: any = { prompt };
      if (template !== "auto") body.template = template;

      const res = await fetch("/api/generate-apk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": apiSecret,
        },
        body: JSON.stringify(body),
      });

      const data: ApiResp = await res.json();
      setResp(data);

      if (!res.ok || !("ok" in data && data.ok)) {
        const errText = (data as ApiFail)?.error || `请求失败 (${res.status})`;
        throw new Error(errText);
      }

      const ok = data as ApiOk;
      const fileList = ok.files?.map(f => f.path).join("\n - ") || "(无)";
      setMessage(
        `✅ 已写入仓库，并将触发 GitHub Actions 打包\nAppId: ${ok.appId}\n模板: ${ok.template}\n文件: \n - ${fileList}`
      );
    } catch (e: any) {
      setMessage(`❌ 生成失败：${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 rounded-2xl bg-white/10 shadow-xl text-white">
      <h2 className="text-2xl font-bold">一键生成 APK</h2>
      <p className="mt-1 text-sm opacity-80">
        输入需求，选择模板（或自动识别），点下方按钮即可将代码写入打包仓库并触发 CI。
      </p>

      {!apiSecret && (
        <div className="mt-3 rounded-lg bg-red-600/80 p-3 text-sm">
          警告：未读取到 <code className="font-mono">NEXT_PUBLIC_API_SECRET</code>，请求将被后端拒绝。
        </div>
      )}

      <label className="mt-5 block text-sm opacity-90">需求描述（prompt）</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="例如：冥想计时器 90 秒，开始/停止；或：待办清单；或：加载网页 https://example.com"
        className="mt-2 w-full rounded-xl border border-white/20 bg-black/20 p-3 outline-none focus:ring-2 focus:ring-indigo-400 min-h-[96px]"
      />

      <label className="mt-4 block text-sm opacity-90">模板</label>
      <select
        value={template}
        onChange={(e) => setTemplate(e.target.value as any)}
        className="mt-2 w-full rounded-xl border border-white/20 bg-black/20 p-3 outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="auto">自动选择（根据关键字）</option>
        <option value="timer">计时器 / 冥想</option>
        <option value="todo">待办清单</option>
        <option value="webview">网页壳（WebView）</option>
      </select>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="mt-5 w-full rounded-xl bg-indigo-600 py-3 font-semibold shadow hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "正在生成…" : "Generate APK"}
      </button>

      {message && (
        <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-black/30 p-4 text-sm leading-relaxed">
          {message}
        </pre>
      )}

      {resp && (
        <details className="mt-2 rounded-xl bg-black/30 p-4 text-sm">
          <summary className="cursor-pointer opacity-90">响应详情</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(resp, null, 2)}</pre>
        </details>
      )}

      <div className="mt-6 text-xs opacity-70">
        小贴士：构建完成后，下载 CI 产物的 APK；你也可以在 APK 内的 <code className="font-mono">assets/build_marker.txt</code> 查看本次 prompt，验证不是空包。
      </div>
    </div>
  );
}
