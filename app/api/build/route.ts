import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const template = body?.template ?? 'core-template';

  const owner    = process.env.OWNER    ?? 'why459097630';
  const repo     = process.env.REPO     ?? 'Packaging-warehouse';
  const workflow = process.env.WORKFLOW ?? 'android-build-matrix.yml';
  const ref      = process.env.REF      ?? 'main';
  const token    = process.env.GITHUB_TOKEN; // 你在 Vercel 里配置的变量名

  if (!token) {
    return NextResponse.json({ ok:false, error:'GITHUB_TOKEN missing' }, { status: 500 });
  }

  const octokit = new Octokit({ auth: token });

  await octokit.request(
    'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
    { owner, repo, workflow_id: workflow, ref, inputs: { template } }
  );

  return NextResponse.json({ ok: true, dispatched: template });
}
