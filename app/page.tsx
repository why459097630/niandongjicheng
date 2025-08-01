'use client';

import { useState } from 'react';

export default function Home() {
  const [input, setInput] = useState('');
  const [html, setHtml] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [zipUrl, setZipUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const generateApp = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: input }),
      });

      const data = await res.json();
      setHtml(data.html || '');
      setPreviewUrl(data.previewUrl || '');
      setZipUrl(data.zipUrl || '');
    } catch (err) {
      console.error('Generation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '2rem' }}>
      <h1>🌟 Build your app with one sentence</h1>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your app..."
          style={{ flex: 1, padding: '8px', fontSize: '16px' }}
        />
        <button onClick={generateApp} disabled={loading}>
          {loading ? 'Generating...' : 'Generate App'}
        </button>
      </div>

      <h2>🧠 AI Generated HTML:</h2>
      <pre
        style={{
          background: '#eee',
          padding: '1rem',
          maxHeight: '300px',
          overflow: 'auto',
        }}
      >
        {html || 'No content generated'}
      </pre>

      <h2>🔍 Online Preview:</h2>
      {previewUrl ? (
        <iframe
          src={previewUrl}
          style={{ width: '100%', height: '400px', border: '1px solid #ccc' }}
        />
      ) : (
        <p>No preview available</p>
      )}

      <h2>📦 Download:</h2>
      {zipUrl ? (
        <a href={zipUrl} download style={{ fontSize: '16px' }}>
          ⬇️ Click here to download ZIP
        </a>
      ) : (
        <p>No zip available</p>
      )}
    </main>
  );
}
