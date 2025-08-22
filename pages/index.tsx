// 示例：pages/index.tsx 里发起请求的地方
import { ENV } from '@/lib/env';
import { useState } from 'react';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const warnNoSecret = !ENV.PUBLIC_SECRET; // 仅作提示，不阻塞

  async function onGenerate(payload: any) {
    setLoading(true);
    try {
      const resp = await fetch('/api/generate-apk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': ENV.PUBLIC_SECRET ?? '', // 关键：把密钥塞进 header
        },
        body: JSON.stringify(payload),
      });

      const data = await resp.json();
      // 根据 data.ok 提示 & 轮询 CI 状态 ...
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* ... 你的表单 UI */}
      {warnNoSecret && (
        <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          未检测到 <code>NEXT_PUBLIC_API_SECRET</code>，已放行请求（仅作警告）。
          建议在 Vercel 环境变量中设置以防外部滥用。
        </div>
      )}
    </>
  );
}
