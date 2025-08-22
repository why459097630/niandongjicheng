// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { Octokit } from 'octokit'

// 如果你的 env.ts 放在仓库根目录 /lib/env.ts，请保持如下导入；
// 若位置不同，改成相对路径即可（不要用别名导入，避免路径解析问题）。
// @ts-ignore - 在没有这个文件时也允许直接从 process.env 读取
import { serverEnv as envFromFile } from '../../lib/env'

type Data =
  | { ok: true; commit: string; dispatch: 'queued' | 'skipped'; path: string }
  | {
      ok: false
      where?: string
      status?: number
      message?: string
      gh?: any
      errors?: any
    }

const env = {
  GH_OWNER: envFromFile?.GH_OWNER ?? process.env.GH_OWNER ?? '',
  GH_REPO: envFromFile?.GH_REPO ?? process.env.GH_REPO ?? '',
  GH_PAT: envFromFile?.GH_PAT ?? process.env.GH_PAT ?? '',
  GH_BRANCH: envFromFile?.GH_BRANCH ?? process.env.GH_BRANCH ?? 'main',
  API_SECRET: envFromFile?.API_SECRET ?? process.env.API_SECRET ?? '',
  X_API_SECRET: envFromFile?.X_API_SECRET ?? process.env.X_API_SECRET ?? '',
}

function required(name: keyof typeof env) {
  if (!env[name]) throw new Error(`Missing env ${name}`)
}

required('GH_OWNER')
required('GH_REPO')
required('GH_PAT')

const octokit = new Octokit({ auth: env.GH_PAT })

/** 读取文件 sha（若不存在返回 undefined） */
async function getFileSha(params: {
  owner: string
  repo: string
  path: string
  ref: string
}): Promise<string | undefined> {
  try {
    const res = await octokit.rest.repos.getContent(params as any)
    // 当 path 指向文件时，data 为一个对象而不是数组
    const data: any = res.data
    if (data && typeof data === 'object' && 'sha' in data) return data.sha as string
    return undefined
  } catch (e: any) {
    if (e?.status === 404) return undefined
    throw e
  }
}

/** 创建或更新文件（自动携带 sha） */
async function upsertFile(params: {
  owner: string
  repo: string
  path: string
  branch: string
  message: string
  contentBase64: string
}) {
  const sha = await getFileSha({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    ref: params.branch,
  })

  const res = await octokit.rest.repos.createOrUpdateFileContents({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    branch: params.branch,
    message: params.message,
    content: params.contentBase64,
    sha,
  })

  return res.data?.commit?.sha as string
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Data>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method Not Allowed' })
  }

  // 简单的服务端密钥校验（任选其一）
  const headerSecret = req.headers['x-api-secret'] as string | undefined
  if (env.API_SECRET || env.X_API_SECRET) {
    const expected = env.X_API_SECRET || env.API_SECRET
    if (!headerSecret || headerSecret !== expected) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' })
    }
  }

  try {
    const {
      prompt = '',
      template = 'form-template', // 允许: 'form-template' | 'core-template' | 'simple-template'
      owner = env.GH_OWNER,
      repo = env.GH_REPO,
      branch = env.GH_BRANCH || 'main',
      // 你可以扩展更多字段：appName / packageName / icon 等
      ...rest
    } = (req.body || {}) as Record<string, any>

    // 1) 组装要写入仓库的 pack.json（确保是字符串 → base64）
    const pack = {
      version: 1,
      createdAt: new Date().toISOString(),
      template,
      prompt,
      payload: rest, // 将额外字段也存进去，Android 侧可自由读取
    }
    const json = JSON.stringify(pack, null, 2)
    const contentBase64 = Buffer.from(json, 'utf8').toString('base64')

    const path = 'content_pack/pack.json'
    const message = `chore(api): update ${path} via API`

    // 2) 提交到目标仓库（自动 create 或 update）
    const commitSha = await upsertFile({
      owner,
      repo,
      path,
      branch,
      message,
      contentBase64,
    })

    // 3) 触发 workflow_dispatch；若没有权限/未开启也不会阻断（返回 queued | skipped）
    let dispatch: 'queued' | 'skipped' = 'skipped'
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: 'android-build-matrix.yml', // 与 .github/workflows 下文件名一致
        ref: branch,
        inputs: {
          reason: 'api',
          template,
        } as any,
      })
      dispatch = 'queued'
    } catch (e: any) {
      // 如果你依赖 push 触发（on.push.paths 包含 content_pack/**），这里失败也能靠 push 启动构建
      console.warn('DISPATCH_FAILED', {
        status: e?.status,
        message: e?.message,
        response: e?.response?.data,
      })
    }

    return res.status(200).json({
      ok: true,
      commit: commitSha,
      dispatch,
      path,
    })
  } catch (err: any) {
    // 把 GitHub 的详细报错透出，方便排查
    console.error('GH_ERROR', {
      status: err?.status,
      url: err?.request?.url,
      message: err?.message,
      response: err?.response?.data,
    })
    return res.status(500).json({
      ok: false,
      where: err?.request?.url ?? 'unknown',
      status: err?.status ?? 500,
      message: err?.message ?? 'GitHub request failed',
      gh: err?.response?.data?.message,
      errors: err?.response?.data?.errors,
    })
  }
}
