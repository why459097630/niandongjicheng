// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { pushToGithubCore, type PushPayload } from './push-to-github'

const VALID_TEMPLATES = new Set(['core-template', 'form-template', 'simple-template'])

// 可用环境变量覆盖
const OWNER = process.env.GH_OWNER ?? 'why459097630'
const REPO  = process.env.GH_REPO  ?? 'Packaging-warehouse'
const REF   = process.env.GH_REF   ?? 'main'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end()
    // 简单鉴权（与原逻辑一致）
    if (req.headers['x-api-secret'] !== process.env.X_API_SECRET)
      return res.status(401).json({ ok: false, error: 'unauthorized' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const prompt   = String(body?.prompt ?? '')
    const template = String(body?.template ?? '')

    if (!VALID_TEMPLATES.has(template)) {
      return res.status(400).json({
        ok: false,
        error: `template must be one of: ${[...VALID_TEMPLATES].join('|')}`,
      })
    }
    if (prompt.trim().length < 10) {
      return res.status(400).json({ ok: false, error: 'prompt too short' })
    }

    // 唯一时间戳，避免缓存
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '')

    const payload: PushPayload = {
      owner: OWNER,
      repo: REPO,
      ref: REF,
      message: `ci: trigger ${template} @ ${ts}`,
      files: [
        // 1) 构建触发器（内容随便写点，携带 prompt 更直观）
        { path: `app/src/main/assets/build_marker_${ts}.txt`, content: prompt },
        // 2) 模板标记文件（CI 读取它来套模板 & 校验，避免空包）
        { path: 'app/src/main/assets/template.marker', content: template },
      ],
    }

    const ret = await pushToGithubCore(payload)
    return res.status(200).json({ ok: true, template, commit: ret.commit })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
