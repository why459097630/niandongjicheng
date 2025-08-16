import { NextResponse } from 'next/server';

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  const runId = params.runId;
  const repo = process.env.GITHUB_REPO!; // e.g. "why459097630/Packaging-warehouse"
  const [owner, repoName] = repo.split('/');
  const token = process.env.GITHUB_TOKEN!;

  const runRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/runs/${runId}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
  );
  if (!runRes.ok) return NextResponse.json({ ok: false, error: 'GITHUB_API', status: runRes.status });
  const run = await runRes.json();

  const status = run.status as string; // queued|in_progress|completed
  const conclusion = run.conclusion as string | null; // success|failure|cancelled|null

  let downloadUrl: string | null = null;
  if (status === 'completed' && conclusion === 'success') {
    const tag = `run-${runId}`;
    downloadUrl = `https://github.com/${owner}/${repoName}/releases/tag/${tag}`;
  }

  return NextResponse.json({ ok: true, status, conclusion, downloadUrl, runId });
}
