import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceOrigin, rateLimit, ok, fail, HttpError } from './_lib/guard';

const GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN; // Vercel 变量里放 PAT
const owner = 'why459097630';
const repo  = 'Packaging-warehouse';
const workflowId = 'android-build-matrix.yml'; // 或具体 id

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    enforceOrigin(req);
    rateLimit(req, 6);

    if (req.method !== 'POST') throw new HttpError(405, 'Method Not Allowed', 'method_not_allowed');
    if (!GH) throw new HttpError(500, 'GITHUB_TOKEN missing', 'token_missing');

    const template = (req.body?.template || 'core-template') as string;

    // 触发 workflow_dispatch（重试 3 次，指数回退）
    const body = { ref: 'main', inputs: { template } };
    let lastErr: any;
    for (let i = 0, backoff = 500; i < 3; i++, backoff *= 2) {
      try {
        const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': `token ${GH}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (r.status === 204) { // GitHub 成功无正文
          return ok(res, { dispatched: template });
        }
        // 非 204 视为失败
        const text = await r.text();
        throw new Error(`dispatch failed(${r.status}): ${text}`);
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    throw new HttpError(502, `dispatch error: ${lastErr?.message || 'unknown'}`, 'dispatch_failed');

  } catch (e) { fail(res, e); }
}
