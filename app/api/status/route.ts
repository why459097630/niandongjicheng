// app/api/status/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId) return NextResponse.json({ ok: false, error: 'missing runId' }, { status: 400 });

  const owner = process.env.GH_OWNER!, repo = process.env.GH_REPO!, wf = process.env.WORKFLOW_ID!;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${/^\d+$/.test(wf)?wf:`${wf.endsWith('.yml')?wf:`${wf}.yml`}`}/runs?per_page=20`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.GH_PAT}`, 'X-GitHub-Api-Version': '2022-11-28' } });
  const j = await r.json();

  // 按 commit message 或 artifacts 名里是否包含 runId 来匹配
  const hit = j.workflow_runs?.find((x: any) =>
    (x.head_commit?.message || '').includes(runId) || (x.name || '').includes(runId)
  );
  if (!hit) return NextResponse.json({ ok: false, status: 'pending', runs: j?.total_count ?? 0 });

  const artsResp = await fetch(hit.artifacts_url, { headers: { Authorization: `Bearer ${process.env.GH_PAT}` } });
  const arts = await artsResp.json();

  return NextResponse.json({
    ok: true,
    status: hit.status,
    conclusion: hit.conclusion,
    html_url: hit.html_url,
    artifact: arts?.artifacts?.[0]?.archive_download_url ?? null,
  });
}
