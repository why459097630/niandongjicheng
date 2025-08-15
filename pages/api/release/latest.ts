import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceOrigin, rateLimit, ok, fail } from './_lib/guard';

const GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const owner = 'why459097630';
const repo  = 'Packaging-warehouse';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    enforceOrigin(req);
    rateLimit(req, 10);
    if (!GH) throw new Error('GITHUB_TOKEN missing');

    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { Authorization: `token ${GH}`, Accept: 'application/vnd.github+json' }
    });
    const rel = await r.json();
    ok(res, {
      tag: rel.tag_name || rel.name || '',
      assets: (rel.assets || []).map((a: any) => ({
        name: a.name,
        browser_download_url: a.browser_download_url,
      })),
    });

  } catch (e) { fail(res, e); }
}
