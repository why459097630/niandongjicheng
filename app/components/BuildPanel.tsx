'use client';
import { useEffect, useState } from 'react';

type Props = { runId: number | string };

export default function BuildPanel({ runId }: Props) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!runId) return;
    let alive = true;

    const poll = async () => {
      try {
        const r = await fetch(`/api/generate-apk/status/${runId}`, { cache: 'no-store' }).then(res => res.json());
        if (!alive) return;
        setData(r);
        if (r?.status && r.status !== 'completed') {
          setTimeout(poll, 5000);
        }
      } catch {
        // 忽略瞬时错误�?s 后再�?
        setTimeout(poll, 5000);
      }
    };

    poll();
    return () => { alive = false; };
  }, [runId]);

  return (
    <pre className="text-xs text-white/80 bg-black/30 p-3 rounded-xl overflow-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
