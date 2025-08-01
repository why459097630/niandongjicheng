import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("");

  const handleUpload = async () => {
    setStatus("上传中...");

    try {
      const payload = {
        html: "<!DOCTYPE html><html><head><title>Hello App</title></head><body><h1>Hello World</h1></body></html>",
        css: "body { font-family: Arial, sans-serif; background: #f9f9f9; }",
        js: "console.log('App started');"
      };

      const res = await fetch("/api/push-to-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok) {
        setStatus(`✅ 上传成功：${data.message || "已提交 GitHub"}`);
      } else {
        setStatus(`❌ 上传失败：${data.error || "未知错误"}`);
      }
    } catch (err) {
      console.error(err);
      setStatus("❌ 上传失败：网络错误");
    }
  };

  return (
    <div style={{ padding: "3rem", fontFamily: "sans-serif" }}>
      <h1>念动即成 - 一句话生成 App</h1>
      <button
        onClick={handleUpload}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          border: "1px solid #ccc",
          borderRadius: "6px",
          cursor: "pointer"
        }}
      >
        上传到 GitHub 并触发打包
      </button>
      {status && <p style={{ marginTop: "1rem", fontSize: "1rem", color: status.startsWith("✅") ? "green" : "red" }}>{status}</p>}
    </div>
  );
}
