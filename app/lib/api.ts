// app/lib/api.ts
export async function getBuildStatus(runId: number | string) {
  if (!runId) throw new Error('MISSING_RUN_ID');
  const res = await fetch(`/api/build/status/${runId}`, { cache: 'no-store' });
  return res.json();
}
