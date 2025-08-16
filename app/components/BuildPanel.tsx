'use client';
import { useEffect, useState } from 'react';

type Props = { runId: number | string };

default export function BuildPanel({ runId }: Props) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/build/status/${runId}`, { cache: 'no-store' }).then((r) => r.json());
        if (!alive) return;
        setData(r);
        if (r?.ok && r?.status && r.status !== 'completed') setTimeout(tick, 5000);
      } catch (e) {
        // 忽略瞬时错误，下一轮再拉
        setTimeout(tick, 5000);
      }
    };
    tick();
    return () => { alive = false; };
  }, [runId]);

  return <pre className="text-xs text-white/80 bg-black/30 p-3 rounded-xl overflow-auto">{JSON.stringify(data, null, 2)}</pre>;
}
