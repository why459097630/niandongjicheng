import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sha = searchParams.get('sha');
  if (!sha) return NextResponse.json({ ok: false, error: 'MISSING_SHA' }, { status: 400 });

  const repo = process.env.GITHUB_REPO!; // e.g. "why459097630/Packaging-warehouse"
  const [owner, repoName] = repo.split('/');
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE || 'android-build-matrix.yml';
  const token = process.env.GITHUB_TOKEN!;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflowFile}/runs?per_page=20&branch=main`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );

  if (!res.ok) return NextResponse.json({ ok: false, error: 'GITHUB_API', status: res.status });
  const data = await res.json();
  const run = (data.workflow_runs || []).find((r: any) => r.head_sha === sha);
  if (!run) return NextResponse.json({ ok: false, notFound: true });

  return NextResponse.json({ ok: true, runId: run.id, status: run.status, conclusion: run.conclusion });
}
