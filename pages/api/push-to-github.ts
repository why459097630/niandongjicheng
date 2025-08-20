// pages/api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next'

export type PushFile = { path: string; content: string; base64?: boolean }
export type PushPayload = {
  owner: string
  repo: string
  ref: string              // 分支，如 'main'
  message: string
  files: PushFile[]
}

type GHRef = { object: { sha: string } }
type GHBlob = { sha: string }
type GHTree = { sha: string }
type GHCommit = { sha: string; html_url?: string }

const GH = (path: string) => `https://api.github.com${path}`

async function gh<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = process.env.GH_TOKEN
  if (!token) throw new Error('Missing env GH_TOKEN')

  const resp = await fetch(GH(path), {
    ...init,
    headers: {
      'authorization': `Bearer ${token}`,
      'accept': 'application/vnd.github+json',
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(`GitHub ${resp.status}: ${text}`)
  }
  return text ? (JSON.parse(text) as T) : (undefined as any)
}

/**
 * 把多文件一次性提交为一个 commit
 */
export async function pushToGithubCore(payload: PushPayload) {
  const { owner, repo, ref, message, files } = payload
  if (!owner || !repo || !ref) throw new Error('owner/repo/ref required')
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('files required')
  }

  // 1) 找到分支当前 commit
  const head = await gh<GHRef>(`/repos/${owner}/${repo}/git/ref/heads/${ref}`)

  // 2) 为每个文件创建 blob
  const blobs: { path: string; sha: string; mode: '100644'; type: 'blob' }[] = []
  for (const f of files) {
    const blob = await gh<GHBlob>(`/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: f.content,
        encoding: f.base64 ? 'base64' : 'utf-8',
      }),
    })
    blobs.push({ path: f.path, sha: blob.sha, mode: '100644', type: 'blob' })
  }

  // 3) 创建 tree
  const tree = await gh<GHTree>(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: head.object.sha,
      tree: blobs,
    }),
  })

  // 4) 创建 commit
  const commit = await gh<GHCommit>(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [head.object.sha],
    }),
  })

  // 5) 移动分支到新 commit
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${ref}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false }),
  })

  return { ok: true, commit: commit.sha }
}

// =========== 兼容保留原有 HTTP API ============

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end()
    if (req.headers['x-api-secret'] !== process.env.X_API_SECRET)
      return res.status(401).json({ ok: false, error: 'unauthorized' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const ret = await pushToGithubCore(body as PushPayload)
    res.status(200).json(ret)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
