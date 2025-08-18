import type { NextApiRequest, NextApiResponse } from 'next';

type BodyShape = {
  packageName?: string;
  java?: Record<string, string>;
  resLayout?: Record<string, string>;
  resValues?: Record<string, string>;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // ---- 兼容你现有环境变量（方案 B）----
  const GH_TOKEN  = process.env.GH_TOKEN  || process.env.GITHUB_TOKEN;
  const GH_OWNER  = process.env.GH_OWNER  || process.env.OWNER;
  const GH_REPO   = process.env.GH_REPO   || process.env.REPO;
  const GH_BRANCH = process.env.GH_BRANCH || process.env.REF || 'main';

  if (!GH_TOKEN || !GH_OWNER || !GH_REPO || !GH_BRANCH) {
    return res.status(500).json({
      ok: false,
      error:
        'Missing GitHub envs (need GH_TOKEN, GH_OWNER/OWNER, GH_REPO/REPO, GH_BRANCH/REF)',
    });
  }

  // helper：注意用函数表达式而不是块级 function 声明
  const getFileSha = async (path: string): Promise<string | null> => {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(
      path
    )}?ref=${encodeURIComponent(GH_BRANCH)}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Get sha failed for ${path}: ${r.status} ${await r.text()}`);
    const json = (await r.json()) as { sha?: string };
    return json.sha ?? null;
  };

  const upsertFile = async (path: string, raw: string) => {
    const sha = await getFileSha(path);
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(
      path
    )}`;
    const message = `chore(gen): update ${path} @ ${new Date().toISOString()}`;
    const content = Buffer.from(raw, 'utf8').toString('base64');

    const body: Record<string, unknown> = {
      message,
      content,
      branch: GH_BRANCH,
    };
    if (sha) body.sha = sha;

    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Upsert failed for ${path}: ${r.status} ${t}`);
    }
    return r.json();
  };

  try {
    // 兼容 req.body 可能为 string 的情况
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { packageName, java = {}, resLayout = {}, resValues = {} } = (raw ||
      {}) as BodyShape;

    const mainJava = java['MainActivity.java'] || '';
    const activityXml = resLayout['activity_main.xml'] || '';
    const stringsXml = resValues['strings.xml'] || '';

    if (!mainJava || !activityXml || !stringsXml) {
      return res.status(400).json({
        ok: false,
        error:
          'Payload missing: need java.MainActivity.java, resLayout.activity_main.xml, resValues.strings.xml',
      });
    }

    const files = [
      { path: 'demo_payload/MainActivity.java.txt', content: mainJava },
      { path: 'demo_payload/activity_main.xml.txt', content: activityXml },
      { path: 'demo_payload/strings.xml.txt', content: stringsXml },
    ];

    for (const f of files) {
      await upsertFile(f.path, f.content);
    }

    return res.status(200).json({
      ok: true,
      owner: GH_OWNER,
      repo: GH_REPO,
      branch: GH_BRANCH,
      packageName: packageName ?? null,
      written: files.map((f) => f.path),
    });
  } catch (err: any) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: String(err?.message || err) });
  }
}
