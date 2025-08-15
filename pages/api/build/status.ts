import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceOrigin, rateLimit, ok, fail } from './_lib/guard';

const GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const owner = 'why459097630';
const repo  = 'Packaging-warehouse';
const workflowFile = 'android-build-matrix.yml';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    enforceOrigin(req);
    rateLimit(req, 20); // 轮询频率允许略高一点

    if (!GH) throw new Error('GITHUB_TOKEN missing');

    // 取最近一次 run
    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?per_page=1`;
    const r = await fetch(url, { headers: { Authorization: `token ${GH}`, Accept: 'application/vnd.github+json' }});
    const data = await r.json();
    const run = data?.workflow_runs?.[0] || { status: 'queued' };
    ok(res, { run: { status: run.status, conclusion: run.conclusion } });

  } catch (e) { fail(res, e); }
}
