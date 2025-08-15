// pages/api/build.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';

// ✅ 可选：智能模板兜底（未传 template 时基于 prompt 推断）
import { pickTemplateByText } from './_lib/pickTemplateByText';

// --------- 环境变量 ----------
const GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const OWNER = process.env.OWNER || 'why459097630';
const REPO = process.env.REPO || 'Packaging-warehouse';
const WORKFLOW = process.env.WORKFLOW || 'android-build-matrix.yml';
const REF = process.env.REF || 'main';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// --------- 工具: CORS ----------
function withCORS(res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 在仓库里读取 /templates 目录，拿到可用模板名
async function listTemplates(octokit: Octokit): Promise<string[]> {
  const items = await octokit.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path: 'templates',
  });

  // GitHub API 在目录场景返回的是数组
  if (Array.isArray(items.data)) {
    return items.data
      .map((it: any) => it?.name)
      .filter((name: string | undefined) => !!name) as string[];
  }
  return [];
}

type BuildBody =
  | { template?: string; prompt?: string } // 正常 JSON
  | undefined;

/**
 * POST /api/build
 * body: { template?: 'core-template' | 'simple-template' | 'form-template', prompt?: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  withCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
  }

  // 基础校验
  if (!GH_TOKEN) {
    return res
      .status(500)
      .json({ ok: false, message: 'Missing GH_TOKEN/GITHUB_TOKEN in environment.' });
  }

  const octokit = new Octokit({ auth: GH_TOKEN });

  try {
    const body = (req.body || {}) as BuildBody;

    // 1) 兜底推断模板：没传 template 时，如果有 prompt，就智能选择
    let template = body?.template?.trim();
    const prompt = body?.prompt?.trim();
    if (!template && prompt) {
      template = pickTemplateByText(prompt);
    }

    // 2) 拉取仓库的 /templates 目录，校验模板是否存在
    const available = await listTemplates(octokit);
    // 一般你这里会看到 ['core-template', 'form-template', 'simple-template']
    if (!template) {
      // 再兜底一次：没有 prompt、也没传 template，则默认 core-template
      template = 'core-template';
    }
    if (!available.includes(template)) {
      return res.status(400).json({
        ok: false,
        message: `Invalid template: "${template}". Available: ${available.join(', ')}.`,
      });
    }

    // 3) 触发 workflow_dispatch（204 成功）
    await octokit.actions.createWorkflowDispatch({
      owner: OWNER,
      repo: REPO,
      workflow_id: WORKFLOW,
      ref: REF,
      inputs: {
        template, // 这里要和 workflow_dispatch.inputs.template 保持一致
      },
    });

    // 4) 返回前端可用的结果
    return res.status(200).json({
      ok: true,
      dispatched: template,
      repo: `${OWNER}/${REPO}`,
      workflow: WORKFLOW,
      ref: REF,
    });
  } catch (err: unknown) {
    // 统一错误处理
    const isReqErr = err instanceof RequestError;
    const status = isReqErr && err.status ? err.status : 500;

    return res.status(status).json({
      ok: false,
      message: isReqErr ? err.message : 'Unexpected error',
      detail: isReqErr ? err.response?.data : String(err),
    });
  }
}
