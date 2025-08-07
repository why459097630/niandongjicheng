import { useState } from 'react';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [apkUrl, setApkUrl] = useState('');

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setGeneratedHtml('');
    setPreviewHtml('');
    setApkUrl('');

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || '生成失败');

      setGeneratedHtml(data.html || '');
      setPreviewHtml(data.previewHtml || '');
      setApkUrl(data.zipUrl || '');
    } catch (err: any) {
      alert(`生成失败：${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1 style={{ fontSize: '28px', fontWeight: 'bold' }}>🌟 Build your app with one sentence</h1>

      <div style={{ marginTop: 16 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="生成一个展示我收藏的古代文物的 App，每个文物有名称、朝代、图片和简介。"
          style={{ width: '100%', padding: 12, fontSize: 16 }}
        />
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            marginTop: 8,
            padding: '10px 20px',
            fontSize: 16,
            backgroundColor: '#333',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? '生成中…' : '生成 App'}
        </button>
      </div>

      <hr style={{ margin: '32px 0' }} />

      <h2>🧠 AI Generated HTML:</h2>
      <pre style={{ background: '#f0f0f0', padding: 16, overflow: 'auto' }}>{generatedHtml || 'No content generated'}</pre>

      <h2>🔍 Online Preview:</h2>
      {previewHtml ? (
        <div
          dangerouslySetInnerHTML={{ __html: previewHtml }}
          style={{
            border: '1px solid #ccc',
            padding: 16,
            marginTop: 12,
            background: '#fff',
          }}
        />
      ) : (
        <p>No preview available</p>
      )}

      <h2>📦 Download:</h2>
      {apkUrl ? (
        <a href={apkUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'blue' }}>
          点击下载 APK 安装包
        </a>
      ) : (
        <p>No apk available</p>
      )}
    </main>
  );
}
