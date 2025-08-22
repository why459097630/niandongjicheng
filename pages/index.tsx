import { useState, FormEvent } from 'react';
import type { NextPage } from 'next';

type ApiOk = { ok: true; commitUrl: string; runTriggered: boolean };
type ApiFail = { ok: false; message: string; detail?: any };
type ApiResp = ApiOk | ApiFail;

const IndexPage: NextPage = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [template, setTemplate] = useState<string>('form-template');
  const [loading, setLoading] = useState<boolean>(false);
  const [msg, setMsg] = useState<string>('');
  const [okUrl, setOkUrl] = useState<string>('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    setOkUrl('');
    if (!prompt.trim()) {
      setMsg('请先填写需求描述（prompt）');
      return;
    }

    setLoading(true);
    try {
      // ✅ 同源调用：不再写完整域名，也不再使用 NEXT_PUBLIC_API_BASE
      const resp = await fetch('/api/generate-apk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 可选：若服务器配置了 API_SECRET/X_API_SECRET，就在前端通过公开环境变量传过去
          'x-api-secret': process.env.NEXT_PUBLIC_API_SECRET ?? '',
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          template,
        }),
      });

      const data: ApiResp = await resp.json();

      if (!resp.ok || !data.ok) {
        const reason = !resp.ok ? `${resp.status} ${resp.statusText}` : (data as ApiFail).message;
        setMsg(`生成失败：${reason}`);
        return;
      }

      setOkUrl((data as ApiOk).commitUrl);
      setMsg('已写入仓库并触发构建（如配置），请到 GitHub Actions 查看进度。');
    } catch (err: any) {
      setMsg(`网络错误：${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #121826, #1f2937)',
      color: '#fff',
      padding: '40px 20px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 840,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 24
      }}>
        <h1 style={{ fontSize: 28, margin: 0, marginBottom: 12 }}>一键生成 APK</h1>
        <p style={{ opacity: 0.85, marginTop: 0 }}>
          输入需求，并从下拉框选择模板（core-template / form-template / simple-template），会把内容写入仓库并触发 CI。
        </p>

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', marginBottom: 8 }}>需求描述（prompt）</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：生成一个介绍茶品的安卓 app，要可以上传照片和文字介绍，可以标价，要有登录系统"
            rows={6}
            style={{
              width: '100%',
              resize: 'vertical',
              borderRadius: 8,
              padding: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(0,0,0,0.25)',
              color: '#fff',
              outline: 'none'
            }}
          />

          <div style={{ height: 16 }} />

          <label style={{ display: 'block', marginBottom: 8 }}>模板</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            style={{
              width: '100%',
              borderRadius: 8,
              padding: '10px 12px',
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(0,0,0,0.25)',
              color: '#fff',
              outline: 'none'
            }}
          >
            <option value="form-template">Form 模板（form-template）</option>
            <option value="core-template">Core 模板（core-template）</option>
            <option value="simple-template">Simple 模板（simple-template）</option>
          </select>

          <div style={{ height: 16 }} />

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              height: 44,
              borderRadius: 8,
              background: loading ? 'rgba(59,130,246,0.6)' : '#3b82f6',
              border: 'none',
              color: '#fff',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? '生成中…' : 'Generate APK'}
          </button>
        </form>

        <div style={{ height: 16 }} />

        {msg && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              lineHeight: 1.5
            }}
          >
            {msg}
            {okUrl && (
              <>
                <br/>
                提交链接：&nbsp;
                <a href={okUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>
                  {okUrl}
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default IndexPage;
