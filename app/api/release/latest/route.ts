import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export const runtime = 'nodejs';

export async function GET() {
  const owner = process.env.OWNER ?? 'why459097630';
  const repo  = process.env.REPO  ?? 'Packaging-warehouse';
  const token = process.env.GITHUB_TOKEN;

  if (!token) return NextResponse.json({ ok:false, error:'GITHUB_TOKEN missing' }, { status: 500 });
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', { owner, repo });

  return NextResponse.json({
    ok: true,
    tag: data.tag_name,
    name: data.name,
    created_at: data.created_at,
    assets: data.assets.map(a => ({
      id: a.id,
      name: a.name,
      size: a.size,
      content_type: a.content_type,
      updated_at: a.updated_at,
      download_url: a.browser_download_url
    }))
  });
}
