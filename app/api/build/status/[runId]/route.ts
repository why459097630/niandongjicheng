import { NextResponse } from 'next/server';

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  const runId = params.runId;

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN!;
  const owner = (process.env.GITHUB_REPO?.split('/')[0]) || process.env.OWNER!;
  const repoName = (process.env.GITHUB_REPO?.split('/')[1]) || process.env.REPO!;

  if (!token || !owner || !repoName) {
    return NextResponse.json({ ok: false, error: 'ENV_MISSING' }, { status: 500 });
  }

  const runRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/runs/${runId}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!runRes.ok) return NextResponse.json({ ok: false, error: 'GITHUB_API', status: runRes.status });
  const run = await runRes.json();

  const status = run.status as string;            // queued | in_progress | completed
  const conclusion = run.conclusion as string | null; // success | failure | cancelled | null

  let downloadUrl: string | null = null;
  if (status === 'completed' && conclusion === 'success') {
    const tag = `run-${runId}`;
    downloadUrl = `https://github.com/${owner}/${repoName}/releases/tag/${tag}`;
  }

  return NextResponse.json({ ok: true, status, conclusion, downloadUrl, runId });
}
