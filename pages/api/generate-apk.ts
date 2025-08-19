// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type GhFile = { path: string; sha?: string }
type Ok = { ok: true; appId: string; template: string; files: GhFile[] }
type Fail = { ok: false; error: string; detail?: any }
type Result = Ok | Fail

// 简单转义（用于 strings.xml）
function xmlText(s: string) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/%/g, '%%')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  // CORS
  const allow = process.env.ALLOW_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', allow)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-secret')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  // Auth
  const secret = (process.env.API_SECRET || '').trim()
  const incoming = String(req.headers['x-api-secret'] || (req.body as any)?.apiSecret || '').trim()
  if (!secret || incoming !== secret) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: bad x-api-secret' })
  }

  // ENV
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const GITHUB_OWNER = process.env.GITHUB_OWNER || process.env.OWNER
  const GITHUB_REPO = process.env.GITHUB_REPO || process.env.REPO
  const BRANCH = process.env.REF || 'main'
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({ ok: false, error: 'Missing env: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO' })
  }

  const { prompt = '', template } = (req.body || {}) as { prompt?: string; template?: string }
  const ALLOWED = ['core-template', 'form-template', 'simple-template'] as const
  if (!template || !(ALLOWED as readonly string[]).includes(template)) {
    return res.status(400).json({ ok: false, error: `Bad template: ${template}` })
  }

  // appId / pkgPath
  const slug = (prompt || 'myapp').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^\d+/, '') || 'myapp'
  const appId = `com.example.${slug}`
  const pkgPath = appId.replace(/\./g, '/')
  const appName = (prompt || 'MyApp').slice(0, 30)
  const ts = new Date().toISOString()
  const marker = `__PROMPT__${prompt || 'EMPTY'}__ @ ${ts}`

  // GitHub helpers
  const base = `https://api.github.com/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}`
  const ghFetch = (url: string, init?: RequestInit) =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'tpl-copier',
        ...(init?.headers || {}),
      } as any,
    })

  async function ghGet(path: string, ref = BRANCH): Promise<any | null> {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}?ref=${ref}`)
    if (r.status === 200) return r.json()
    return null
  }

  async function ghList(path: string, ref = BRANCH): Promise<any[] | null> {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}?ref=${ref}`)
    if (r.status === 200) {
      const j = await r.json()
      return Array.isArray(j) ? j : null
    }
    return null
  }

  async function upsert(path: string, content: string, message = 'feat: generate from template'): Promise<GhFile> {
    let sha: string | undefined
    const got = await ghGet(path)
    if (got?.sha) sha = got.sha
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        branch: BRANCH,
        content: Buffer.from(content, 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    })
    if (r.status < 200 || r.status >= 300) throw new Error(`Write ${path} failed: ${r.status} ${await r.text()}`)
    const data = (await r.json()) as any
    return { path, sha: data?.content?.sha }
  }

  async function ghDelete(path: string, sha: string, message = 'chore: remove old MainActivity.java [skip ci]') {
    const r = await ghFetch(`${base}/contents/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: BRANCH }),
    })
    if (r.status < 200 || r.status >= 300) throw new Error(`Delete ${path} failed: ${r.status} ${await r.text()}`)
  }

  // 删除历史包名下的 MainActivity，避免重复
  async function cleanOldJava(targetPkgPath: string) {
    const root = 'app/src/main/java/com/example'
    const dirs = await ghList(root)
    if (!dirs) return
    const desired = `${targetPkgPath}/MainActivity.java`.replace(/^app\/src\/main\/java\//, '')
    for (const d of dirs) {
      if (d.type !== 'dir') continue
      const filePath = `${root}/${d.name}/MainActivity.java`
      const got = await ghGet(filePath)
      if (got?.sha) {
        const rel = filePath.replace(/^app\/src\/main\/java\//, '')
        if (rel !== desired) {
          await ghDelete(filePath, got.sha)
        }
      }
    }
  }

  // 递归读取模板目录
  async function walk(dirPath: string, acc: any[] = []) {
    const list = await ghList(dirPath)
    if (!list) return acc
    for (const it of list) {
      if (it.type === 'dir') {
        await walk(it.path, acc)
      } else if (it.type === 'file') {
        acc.push(it)
      }
    }
    return acc
  }

  // 对文件内容做占位符替换 & 包名替换
  function transformContent(raw: string, srcPath: string) {
    let s = raw

    // 常见占位符
    const replacements: Record<string, string> = {
      '{{APP_ID}}': appId,
      '__APP_ID__': appId,
      '$APP_ID$': appId,
      '@@APP_ID@@': appId,

      '{{APP_NAME}}': appName,
      '__APP_NAME__': appName,
      '$APP_NAME$': appName,
      '@@APP_NAME@@': appName,

      '{{PROMPT}}': prompt,
      '__PROMPT__': prompt,
      '$PROMPT$': prompt,
      '@@PROMPT@@': prompt,
    }
    for (const [k, v] of Object.entries(replacements)) {
      s = s.split(k).join(v)
    }

    // build.gradle 的 namespace
    if (srcPath.endsWith('build.gradle')) {
      s = s.replace(/namespace\s+"[^"]+"/, `namespace "${appId}"`)
    }

    // Java/Kotlin package 行
    if (/\.(java|kt)$/.test(srcPath)) {
      s = s.replace(/^package\s+[\w.]+;/m, `package ${appId};`)
      // 常见默认包名替换
      s = s.replace(/com\.example\.[\w.]+/g, appId)
    }

    // strings.xml 可能有占位
    if (srcPath.endsWith('strings.xml')) {
      s = s.replace(/(<string name="app_name">)(.*?)(<\/string>)/, `$1${xmlText(appName)}$3`)
    }

    return s
  }

  // 将模板路径改写为目标路径（修正 Java 包路径）
  function rewriteTargetPath(srcTplPath: string): string {
    // 去掉 templates/<tpl>/ 前缀
    const rel = srcTplPath.replace(/^templates\/[^/]+\//, '')

    // Java/Kotlin 文件统一放入当前包名目录
    const m = rel.match(/^app\/src\/main\/java\/(.+?)\/([^/]+)\.(java|kt)$/)
    if (m) {
      const fileName = `${m[2]}.${m[3]}`
      return `app/src/main/java/${pkgPath}/${fileName}`
    }
    return rel
  }

  try {
    // 1) 删除旧包名 MainActivity
    await cleanOldJava(`app/src/main/java/${pkgPath}`)

    // 2) 读取模板所有文件
    const tplRoot = `templates/${template}`
    const items = await walk(tplRoot)

    const written: GhFile[] = []

    // 3) 对每个文件 读取内容 → 替换 → 目标路径 → upsert
    for (const it of items) {
      // 拉取文件本体（base64）
      const meta = await ghGet(it.path)
      if (!meta?.content) continue
      const raw = Buffer.from(meta.content, 'base64').toString('utf8')

      const targetPath = rewriteTargetPath(it.path)
      const content = transformContent(raw, it.path)

      // 写入
      written.push(await upsert(targetPath, content, `feat: generate from template ${template}`))
    }

    // 4) 附加信息：marker + nudge
    written.push(await upsert('app/src/main/assets/build_marker.txt', marker, 'chore: marker'))
    written.push(await upsert('app/ci_nudge.txt', `${ts}\n${appId}\n`, 'chore: ci nudge'))

    return res.status(200).json({ ok: true, appId, template, files: written })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'Generate failed', detail: String(e?.message || e) })
  }
}
