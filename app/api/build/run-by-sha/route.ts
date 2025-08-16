export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sha = searchParams.get('sha');
  if (!sha) return NextResponse.json({ ok: false, error: 'MISSING_SHA' }, { status: 400 });

  // 兼容你现有的环境变量命名
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN!;
  const owner = (process.env.GITHUB_REPO?.split('/')[0]) || process.env.OWNER!;
  const repoName = (process.env.GITHUB_REPO?.split('/')[1]) || process.env.REPO!;
  const workflowFile = process.env.GITHUB_WORKFLOW_FILE || process.env.WORKFLOW || 'android-build-matrix.yml';
  const branch = process.env.REF || 'main';

  if (!token || !owner || !repoName) {
    return NextResponse.json({ ok: false, error: 'ENV_MISSING' }, { status: 500 });
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflowFile}/runs?per_page=20&branch=${branch}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );

  if (!res.ok) return NextResponse.json({ ok: false, error: 'GITHUB_API', status: res.status });
  const data = await res.json();
  const run = (data.workflow_runs || []).find((r: any) => r.head_sha === sha);
  if (!run) return NextResponse.json({ ok: false, notFound: true });

  return NextResponse.json({ ok: true, runId: run.id, status: run.status, conclusion: run.conclusion });
}
