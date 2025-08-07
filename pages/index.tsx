// pages/index.tsx
import { useState } from "react";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [html, setHtml] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [zipUrl, setZipUrl] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setHtml("");
    setPreviewUrl("");
    setZipUrl("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
      });

      const data = await response.json();

      if (response.ok) {
        setHtml(data.html);
        setPreviewUrl(data.previewUrl);
        setZipUrl(data.zipUrl);
      } else {
        alert("生成失败: " + (data.error || "未知错误"));
      }
    } catch (error) {
      alert("请求出错：" + error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1>🌟 Build your app with one sentence</h1>

      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="请输入一句话描述你想要的 App"
        style={{ width: "100%", padding: "10px", fontSize: "16px", marginBottom: "1rem" }}
      />

      <button onClick={handleGenerate} disabled={loading}>
        {loading ? "生成中..." : "Generate App"}
      </button>

      <h2>🧠 AI Generated HTML:</h2>
      <pre style={{ background: "#eee", padding: "1rem", whiteSpace: "pre-wrap" }}>
        {html || "No content generated"}
      </pre>

      <h2>🔍 Online Preview:</h2>
      {previewUrl ? <a href={previewUrl} target="_blank" rel="noopener noreferrer">Preview App</a> : "No preview available"}

      <h2>📦 Download:</h2>
      {zipUrl ? <a href={zipUrl} download>Download ZIP</a> : "No zip available"}
    </div>
  );
}
