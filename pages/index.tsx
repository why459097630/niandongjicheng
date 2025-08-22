import React, { useState } from 'react';

/**
 * 只在前端使用公开变量（必须以 NEXT_PUBLIC_ 开头）
 * 注意：这些值会被打包进浏览器，请勿放任何私密信息
 */
const PUBLIC_API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const PUBLIC_API_SECRET = process.env.NEXT_PUBLIC_API_SECRET ?? '';

type Template = 'core-template' | 'form-template' | 'simple-template';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [template, setTemplate] = useState<Template>('form-template');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    setResp(null);

    try {
      // 如果设置了外部 API_BASE，就打到外部；否则走 Next 内部路由
      const url =
        (PUBLIC_API_BASE ? PUBLIC_API_BASE.replace(/\/+$/, '') : '') +
        '/api/generate-apk';

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 如果后端需要校验公开秘钥，则把它带上（为空就不传）
          ...(PUBLIC_API_SECRET ? { 'x-api-secret': PUBLIC_API_SECRET } : {}),
        },
        body: JSON.stringify({
          prompt,
          template,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof data?.message === 'string'
            ? data.message
            : `Request failed: ${res.status}`
        );
        setResp(data);
        return;
      }

      setResp(data);
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 880, margin: '40px auto', padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
        一键生成 APK
      </h1>

      <section
        style={{
          border: '1px solid #333',
          borderRadius: 12,
          padding: 16,
          background: '#0f1220',
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>需求描述</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：生成一个介绍茶品的安卓 app..."
            rows={6}
            style={{
              width: '100%',
              resize: 'vertical',
              borderRadius: 8,
              padding: 12,
              border: '1px solid #444',
              background: '#0b0e1a',
              color: '#eaeaea',
            }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 8 }}>模板</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value as Template)}
            style={{
              width: '100%',
              borderRadius: 8,
              padding: 10,
              border: '1px solid #444',
              background: '#0b0e1a',
              color: '#eaeaea',
            }}
          >
            <option value="core-template">Core 模板</option>
            <option value="form-template">Form 模板</option>
            <option value="simple-template">Simple 模板</option>
          </select>
        </div>

        <button
          disabled={loading}
          onClick={generate}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 10,
            background: loading ? '#3a3a3a' : '#5b7cff',
            color: '#fff',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600,
          }}
        >
          {loading ? '正在生成…' : 'Generate APK'}
        </button>

        {/* 提示公开变量是否缺失（仅 UI 友好提示，不影响编译） */}
        {!PUBLIC_API_SECRET && (
          <p
            style={{
              marginTop: 12,
              padding: 12,
              background: '#331d1d',
              color: '#ff9b9b',
              border: '1px solid #5b2a2a',
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            未检测到 <code>NEXT_PUBLIC_API_SECRET</code>。请在 Vercel 或
            本地 <code>.env.local</code> 中配置。
          </p>
        )}
      </section>

      <section style={{ marginTop: 16 }}>
        {error && (
          <pre
            style={{
              padding: 12,
              background: '#331d1d',
              color: '#ff9b9b',
              border: '1px solid #5b2a2a',
              borderRadius: 8,
              overflowX: 'auto',
            }}
          >
            {error}
          </pre>
        )}

        {resp && (
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              background: '#0b0e1a',
              color: '#eaeaea',
              border: '1px solid #333',
              borderRadius: 8,
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(resp, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}
