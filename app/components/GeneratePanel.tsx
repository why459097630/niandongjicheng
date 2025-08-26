"use client";

import { useState } from "react";

export default function GeneratePanel() {
  const [prompt, setPrompt] = useState("");
  const [appName, setAppName] = useState("MyApp");
  const [packageName, setPackageName] = useState("com.example.app");
  const [loading, setLoading] = useState(false);

  async function onGenerate() {
    if (!prompt.trim()) {
      alert("请先输入需求（prompt）");
      return;
    }
    try {
      setLoading(true);
      const res = await fetch("/api/generate-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          appName: appName.trim(),
          packageName: packageName.trim(),
        }),
      });
      const data = await res.json();
      console.log("generate-app:", data);
      if (!res.ok || !data.ok) {
        alert("生成失败：" + (data.error || res.statusText));
        return;
      }
      alert(`已提交到仓库，requestId=${data.requestId}\n请到 GitHub Actions 查看构建进度。`);
    } catch (e: any) {
      console.error(e);
      alert("网络或服务器异常：" + (e?.message || String(e)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto p-6 rounded-lg bg-slate-800/60 space-y-4">
      <h2 className="text-2xl font-semibold">一键生成 APK</h2>

      <label className="block text-sm opacity-80">需求描述（prompt）</label>
      <textarea
        className="w-full h-40 rounded p-3 text-black"
        placeholder="输入你的需求，例如：生成一个介绍中国历史朝代的App，要有图片和文字介绍"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm opacity-80">App 名称</label>
          <input
            className="w-full rounded p-2 text-black"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm opacity-80">包名（packageName）</label>
          <input
            className="w-full rounded p-2 text-black"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={loading}
        className="w-full py-3 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? "正在提交…" : "Generate APK"}
      </button>

      <p className="text-xs opacity-70">
        已写入仓库并触发构建（如果配置正确），请到 GitHub Actions 查看进度。
      </p>
    </div>
  );
}
