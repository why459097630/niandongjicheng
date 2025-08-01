import { useState } from 'react';

export default function Home() {
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const handleUploadToGitHub = async () => {
    setUploading(true);
    setUploadStatus('⏳ 正在上传到 GitHub...');

    const htmlCode = '<!DOCTYPE html><html><head><title>测试</title></head><body><h1>Hello</h1></body></html>';
    const cssCode = 'body { background: #f0f0f0; color: #333; font-family: sans-serif; }';
    const jsCode = 'console.log("Hello from JS!");';

    try {
      const res = await fetch('/api/push-to-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'Packaging-warehouse',
          path: 'generated-app-' + Date.now(),
          files: [
            { name: 'index.html', content: htmlCode },
            { name: 'style.css', content: cssCode },
            { name: 'script.js', content: jsCode },
          ]
        })
      });

      const data = await res.json();
      if (res.ok) {
        setUploadStatus(`✅ 上传成功！Commit SHA: ${data.commitSha.slice(0, 7)}`);
      } else {
        setUploadStatus(`❌ 上传失败：${data.error || '未知错误'}`);
      }
    } catch (error: any) {
      setUploadStatus(`❌ 上传异常：${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'Arial, sans-serif' }}>
      <h1>念动即成 - 一句话生成 App</h1>
      <button onClick={handleUploadToGitHub} disabled={uploading} style={{ padding: '10px 20px', fontSize: '16px' }}>
        {uploading ? '上传中...' : '上传到 GitHub 并触发打包'}
      </button>
      <p>{uploadStatus}</p>
    </div>
  );
}
