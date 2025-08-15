// pages/api/release/latest.ts
import type { NextApiRequest, NextApiResponse } from 'next';

const OWNER = process.env.OWNER!;
const REPO = process.env.REPO!;
const GH_TOKEN = process.env.GITHUB_TOKEN!; // 你在 Vercel 的变量名

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `token ${GH_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      }
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ ok:false, error:t });
    }
    const data = await r.json();
    const assets = (data.assets || []).map((a: any) => ({
      name: a.name,
      url: a.browser_download_url,
      sha256: (a.label && a.label.startsWith('sha256:')) ? a.label.slice(7) : undefined  // 若你把sha256放在label里
    }));

    res.json({ ok:true, tag: data.tag_name, assets });
  } catch (e:any) {
    res.status(500).json({ ok:false, error:e?.message || 'unknown error' });
  }
}
