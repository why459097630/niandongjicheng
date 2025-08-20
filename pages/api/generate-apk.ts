// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { pushToGithubCore, type PushPayload } from './push-to-github'

// 用数组 + Set，避免对 Set 进行展开迭代（兼容较低 TS target）
const TEMPLATE_LIST = ['core-template', 'form-template', 'simple-template'] as const
const VALID_TEMPLATES = new Set<string>(TEMPLATE_LIST)

const OWNER = process.env.GH_OWNER ?? 'why459097630'
const REPO  = process.env.GH_REPO  ?? 'Packaging-warehouse'
const REF   = process.env.GH_REF   ?? 'main'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).end()

    // 简单鉴权（与前端一致）
    if (req.headers['x-api-secret'] !== process.env.X_API_SECRET) {
      return res.status(401).json({ ok: false, error: 'unauthorized' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const prompt   = String(body?.prompt ?? '')
    const template = String(body?.template ?? '')

    if (!VALID_TEMPLATES.has(template)) {
      return res.status(400).json({
        ok: false,
        error: `template must be one of: ${TEMPLATE_LIST.join('|')}`,
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
        // 触发构建并携带说明
        { path: `app/src/main/assets/build_marker_${ts}.txt`, content: prompt },
        // 固定写入模板标记，供 CI 套模板 + 校验（防止空包）
        { path: 'app/src/main/assets/template.marker', content: template },
      ],
    }

    const ret = await pushToGithubCore(payload)
    return res.status(200).json({ ok: true, template, commit: ret.commit })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
