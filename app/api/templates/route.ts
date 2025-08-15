import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export const runtime = 'nodejs';

export async function GET() {
  const owner = process.env.OWNER ?? 'why459097630';
  const repo  = process.env.REPO  ?? 'Packaging-warehouse';
  const token = process.env.GITHUB_TOKEN;

  if (!token) return NextResponse.json({ ok:false, error:'GITHUB_TOKEN missing' }, { status: 500 });
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.request(
    'GET /repos/{owner}/{repo}/contents/{path}',
    { owner, repo, path: 'templates' }
  );

  const templates = (Array.isArray(data) ? data : [])
    .filter(item => item.type === 'dir')
    .map(item => item.name)
    .filter(name => !['generated', '.github'].includes(name));

  return NextResponse.json({ ok: true, templates });
}
