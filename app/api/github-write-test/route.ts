// app/api/github-write-test/route.ts
export const runtime = 'nodejs';
function must(k:string){const v=process.env[k]; if(!v) throw new Error(`Missing env ${k}`); return v;}
const owner = must('GH_OWNER'); const repo = must('GH_REPO');
const branch = process.env.GH_BRANCH || 'main'; const token = must('GH_PAT');

export async function POST() {
  const rel = 'requests/_health.txt';
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(rel)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  let sha: string|undefined;
  const probe = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
  if (probe.ok) { const j = await probe.json().catch(()=>null); sha = j?.sha; }

  const body = {
    message: 'health-check: write via contents api',
    content: Buffer.from(`OK ${new Date().toISOString()}\n`).toString('base64'),
    branch, sha,
  };
  const r = await fetch(api, { method:'PUT', headers, body: JSON.stringify(body) });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { 'content-type':'application/json' } });
}
