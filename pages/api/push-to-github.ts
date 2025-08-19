// pages/api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type Payload = {
  filePath: string              // 例如: 'app/src/main/java/.../MainActivity.java'
  content: string               // 文件内容（UTF-8 文本；或已 base64）
  message?: string              // commit message
  ref?: string                  // 分支，默认 'main'
  base64?: boolean              // 如果为 true，content 视为已是 base64
}

type GitHubContentGet = {
  sha: string
  content?: string
  encoding?: 'base64' | 'utf-8'
}

const json = (res: NextApiResponse, status: number, body: any) =>
  res.status(status).json(body)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // --- CORS ---
  const allowOrigin = process.env.ALLOW_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed' })
  }

  // --- 安全校验（与 Vercel 环境变量 API_SECRET 一致）---
  const apiSecret = process.env.API_SECRET || ''
  const headerSecret = (req.headers['x-api-secret'] || '') as string
  if (!apiSecret || headerSecret !== apiSecret) {
    return json(res, 401, { ok: false, error: 'Unauthorized: bad x-api-secret' })
  }

  // --- 基础 env ---
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN
  const GITHUB_OWNER = process.env.GITHUB_OWNER
  const GITHUB_REPO  = process.env.GITHUB_REPO

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return json(res, 500, {
      ok: false,
      error: 'Missing env: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO'
    })
  }

  // --- 解析 body ---
  let body: Payload
  try {
    body = req.body as Payload
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body' })
  }

  const filePath = (body.filePath || '').replace(/^\/+/, '') // 去掉前导斜杠
  const commitMsg = body.message || `chore: update ${filePath}`
  const ref = body.ref || 'main'
  const isBase64 = !!body.base64

  if (!filePath || !body.content) {
    return json(res, 400, { ok: false, error: 'filePath & content are required' })
  }

  // --- GitHub REST v3 helpers ---
  const base = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}`
  const ghFetch = (url: string, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'niandongjicheng-uploader',
        ...(init?.headers || {})
      }
    })

  // 1) 先 GET 看是否存在，拿 sha
  let existingSha: string | undefined
  try {
    const getResp = await ghFetch(`${base}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`)
    if (getResp.status === 200) {
      const data = (await getResp.json()) as GitHubContentGet
      existingSha = data.sha
    } else if (getResp.status === 404) {
      existingSha = undefined // 新建
    } else {
      const err = await safeJson(getResp)
      return json(res, getResp.status, {
        ok: false,
        error: 'GitHub GET failed',
        status: getResp.status,
        body: err
      })
    }
  } catch (e: any) {
    return json(res, 502, { ok: false, error: 'Network error on GET', detail: String(e) })
  }

  // 2) 准备 content（base64）
  let contentB64: string
  try {
    contentB64 = isBase64 ? body.content : Buffer.from(body.content, 'utf8').toString('base64')
  } catch (e: any) {
    return json(res, 400, { ok: false, error: 'Failed to encode content to base64', detail: String(e) })
  }

  // 3) PUT 创建或更新
  const putBody: any = {
    message: commitMsg,
    content: contentB64,
    branch: ref
  }
  if (existingSha) putBody.sha = existingSha

  try {
    const putResp = await ghFetch(`${base}/contents/${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      body: JSON.stringify(putBody)
    })

    const data = await safeJson(putResp)

    if (putResp.status >= 200 && putResp.status < 300) {
      // 返回一些关键字段，便于定位问题
      return json(res, 200, {
        ok: true,
        path: filePath,
        ref,
        committed: {
          sha: data?.content?.sha || data?.commit?.sha,
          html_url: data?.content?.html_url,
          commit_url: data?.commit?.html_url
        }
      })
    } else {
      return json(res, putResp.status, {
        ok: false,
        error: 'GitHub write failed',
        status: putResp.status,
        body: data
      })
    }
  } catch (e: any) {
    return json(res, 502, { ok: false, error: 'Network error on PUT', detail: String(e) })
  }
}

async function safeJson(r: Response) {
  try {
    return await r.json()
  } catch {
    try { return await r.text() } catch { return null }
  }
}
