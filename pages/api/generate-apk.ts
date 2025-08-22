// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from 'octokit';

/**
 * 轻量 env 读取（无需依赖额外文件）
 */
function getEnv() {
  const GH_OWNER = process.env.GH_OWNER || '';
  const GH_REPO = process.env.GH_REPO || '';
  const GH_PAT = process.env.GH_PAT || '';
  const SERVER_SECRET =
    process.env.API_SECRET ||
    process.env.X_API_SECRET ||
    process.env.NEXT_PUBLIC_API_SECRET || // 兼容：未配置服务器专用密钥时也可使用该值
    '';

  return { GH_OWNER, GH_REPO, GH_PAT, SERVER_SECRET };
}

type GenerateBody = {
  prompt?: string;
  template?: string; // 'core-template' | 'form-template' | 'simple-template' 等
  appName?: string;
  packageId?: string;
  // 允许前端携带更详细的 payload
  payload?: Record<string, any>;
};

type OkResp = {
  ok: true;
  path: string;
  commitSha: string;
  commitUrl: string;
};

type ErrResp = {
  ok: false;
  message: string;
  detail?: any;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkResp | ErrResp>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const { GH_OWNER, GH_REPO, GH_PAT, SERVER_SECRET } = getEnv();

  // —— 必要环境检测（GitHub 相关）
  if (!GH_OWNER || !GH_REPO || !GH_PAT) {
    return res.status(500).json({
      ok: false,
      message: 'missing GH_* envs',
      detail: { GH_OWNER: !!GH_OWNER, GH_REPO: !!GH_REPO, GH_PAT: !!GH_PAT },
    });
  }

  // —— 统一鉴权（只在配置了服务端密钥时才强制校验）
  const needCheck = Boolean(SERVER_SECRET);
  const headerSecret = (req.headers['x-api-secret'] as string | undefined) ?? '';
  if (needCheck && headerSecret !== SERVER_SECRET) {
    return res.status(401).json({ ok: false, message: 'invalid or missing secret' });
  }

  // —— 解析请求体
  const body = (req.body || {}) as GenerateBody;

  // 给出默认值，避免空字段
  const now = new Date().toISOString();
  const prompt = body.prompt ?? '';
  const template = body.template ?? 'form-template';
  const appName = body.appName ?? 'MyGeneratedApp';
  const packageId = body.packageId ?? 'com.example.generated';
  const extraPayload = body.payload ?? {};

  // 这是 CI 识别的“内容包”文件（你的工作流里已有“Inject content pack (if any)”）
  const targetPath = 'content_pack/app.json';

  // 组装内容写入（可按你的 CI 读取格式调整字段名）
  const contentPack = {
    meta: {
      source: 'api/generate-apk',
      at: now,
    },
    app: {
      name: appName,
      packageId,
      template, // 比如 'form-template'
      prompt,   // 用户输入的说明
    },
    payload: {
      ...extraPayload, // 允许前端扩大数据
    },
  };

  const octokit = new Octokit({ auth: GH_PAT });

  try {
    // 1) 先尝试获取文件，若存在则拿到 sha 以便覆盖
    let sha: string | undefined;
    try {
      const getResp = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner: GH_OWNER,
          repo: GH_REPO,
          path: targetPath,
          headers: { 'If-None-Match': '' }, // 防止缓存
        }
      );
      // @ts-ignore
      sha = getResp.data?.sha;
    } catch (e: any) {
      // 404 代表文件不存在，忽略
      if (e?.status !== 404) {
        throw e;
      }
    }

    // 2) 以 base64 写入（覆盖或新建）
    const contentBase64 = Buffer.from(
      JSON.stringify(contentPack, null, 2),
      'utf-8'
    ).toString('base64');

    const putResp = await octokit.request(
      'PUT /repos/{owner}/{repo}/contents/{path}',
      {
        owner: GH_OWNER,
        repo: GH_REPO,
        path: targetPath,
        message: `chore(content-pack): update by API at ${now}`,
        content: contentBase64,
        sha, // 有 sha -> 覆盖；无 sha -> 新建
        branch: 'main',
      }
    );

    const commitSha = putResp.data.commit.sha;
    const commitUrl = putResp.data.commit.html_url;

    // 3) 返回成功；push 将触发你的 Android CI 构建，不再空包
    return res.status(200).json({
      ok: true,
      path: targetPath,
      commitSha,
      commitUrl,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      message: 'failed to write content pack',
      detail: err?.response?.data || err?.message || String(err),
    });
  }
}
