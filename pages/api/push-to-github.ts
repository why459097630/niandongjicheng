import type { NextApiRequest, NextApiResponse } from 'next';

const GH_TOKEN = process.env.GH_TOKEN!;
const GH_OWNER = 'why459097630';
const GH_REPO = 'Packaging-warehouse';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { filePath, content, message } = req.body;

    if (!filePath || !content) {
      return res.status(400).json({ error: 'filePath and content are required' });
    }

    // 获取文件 SHA（如果存在）
    const getFileSha = async (path: string): Promise<string | null> => {
      const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}`;
      const r = await fetch(url, {
        headers: { Authorization: `token ${GH_TOKEN}` }
      });
      if (r.status === 200) {
        const data = await r.json();
        return data.sha;
      }
      return null;
    };

    const sha = await getFileSha(filePath);

    // 提交文件
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(filePath)}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message || `update ${filePath}`,
        content: Buffer.from(content).toString('base64'),
        sha: sha || undefined
      })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data });
    }

    return res.status(200).json({ success: true, data });

  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
