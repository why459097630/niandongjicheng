'use client';

import { useState } from 'react';

export default function Home() {
  const [input, setInput] = useState('');
  const [html, setHtml] = useState('');
  const [apkUrl, setApkUrl] = useState('');
  const [zipUrl, setZipUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setHtml('');
    setApkUrl('');
    setZipUrl('');

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
      setApkUrl(data.apkUrl || '');
      setZipUrl(data.zipUrl || '');
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: '2rem', maxWidth: 800, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>🌟 Build your app with one sentence</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your app..."
          style={{ flex: 1, padding: '0.5rem', fontSize: '1rem' }}
        />
        <button onClick={handleGenerate} disabled={loading} style={{ padding: '0.5rem 1rem' }}>
          {loading ? 'Generating...' : 'Generate App'}
        </button>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>🧠 AI Generated HTML:</h2>
        {html ? (
          <textarea value={html} readOnly style={{ width: '100%', height: 150, fontFamily: 'monospace' }} />
        ) : (
          <p>No content generated</p>
        )}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>🔍 Online Preview:</h2>
        {html ? (
          <div
            style={{ border: '1px solid #ccc', padding: '1rem', borderRadius: '8px', background: '#fafafa' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <p>No preview available</p>
        )}
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>📦 Download:</h2>
        {zipUrl ? (
          <p>
            <a href={zipUrl} target="_blank" rel="noopener noreferrer">
              Download ZIP
            </a>
          </p>
        ) : (
          <p>No zip available</p>
        )}

        {apkUrl ? (
          <p>
            <a href={apkUrl} target="_blank" rel="noopener noreferrer">
              Download APK
            </a>
          </p>
        ) : (
          <p>No apk available</p>
        )}
      </div>
    </main>
  );
}
