import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export const runtime = 'nodejs';

export async function GET() {
  const owner    = process.env.OWNER    ?? 'why459097630';
  const repo     = process.env.REPO     ?? 'Packaging-warehouse';
  const workflow = process.env.WORKFLOW ?? 'android-build-matrix.yml';
  const token    = process.env.GITHUB_TOKEN;

  if (!token) return NextResponse.json({ ok:false, error:'GITHUB_TOKEN missing' }, { status: 500 });
  const octokit = new Octokit({ auth: token });

  // 取最近一次工作流运行
  const runs = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs',
    { owner, repo, workflow_id: workflow, per_page: 1 }
  );

  const run = runs.data.workflow_runs?.[0];
  if (!run) return NextResponse.json({ ok:true, empty:true });

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      number: run.run_number,
      status: run.status,          // queued | in_progress | completed
      conclusion: run.conclusion,  // success | failure | cancelled | null
      branch: run.head_branch,
      url: run.html_url,
      created_at: run.created_at,
      updated_at: run.updated_at,
    }
  });
}
