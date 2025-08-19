// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'

type Resp = { ok: boolean; error?: string; data?: any }

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  try {
    const { prompt, template } = req.body ?? {}

    // 1) 读取密钥（务必在 Vercel 环境变量里设置 API_SECRET 或 NEXT_PUBLIC_API_SECRET）
    const apiSecret = process.env.API_SECRET || process.env.NEXT_PUBLIC_API_SECRET
    if (!apiSecret) {
      return res.status(500).json({
        ok: false,
        error: 'Missing API_SECRET/NEXT_PUBLIC_API_SECRET on server',
      })
    }

    // 2) 计算 push-to-github 的绝对地址
    const host =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : req.headers.host
          ? `http://${req.headers.host}`
          : 'http://localhost:3000'
    const pushUrl = `${host}/api/push-to-github`

    // 3) 根据模板组装要写入的文件（示例：最小集）
    // 你可按需要把 core-template / form-template / simple-template 的文件内容放进 files 数组
    const files: Array<{ path: string; content: string }> = [
      {
        path: 'app/build.gradle',
        content: `
plugins { id 'com.android.application' }
android {
  namespace "com.example.app"
  compileSdk 34
  defaultConfig {
    applicationId "com.example.app"
    minSdk 24
    targetSdk 34
    versionCode 1
    versionName "1.0"
  }
  buildTypes {
    release {
      minifyEnabled false
      proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
  }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
}
dependencies {
  implementation 'androidx.appcompat:appcompat:1.6.1'
  implementation 'com.google.android.material:material:1.11.0'
  implementation 'androidx.constraintlayout:constraintlayout:2.1.4'
}
        `.trim(),
      },
      // 作为“打标文件”，用于验证是否打进 APK
      {
        path: 'app/src/main/assets/build_marker.txt',
        content: `__FROM_UI__ template=${template ?? 'form-template'}; prompt=${prompt ?? ''}`,
      },
    ]

    // 4) 组织 push body（owner/repo/ref 可从环境变量读取，也可从 req.body 传）
    const owner = process.env.OWNER || 'why459097630'
    const repo = process.env.REPO || 'Packaging-warehouse'
    const ref = process.env.REF || 'main'
    const message = `generate from prompt (${template || 'form-template'})`

    // 5) 调 push-to-github，并且带上 x-api-secret
    const resp = await fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-secret': apiSecret, // 关键！
      },
      body: JSON.stringify({
        owner,
        repo,
        ref,
        message,
        files,      // 这里也可以换成 filePath/content/base64 的结构（单文件写入）
        base64: false,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return res
        .status(resp.status)
        .json({ ok: false, error: `push-to-github failed: ${resp.status} ${text}` })
    }

    const data = await resp.json().catch(() => ({}))
    return res.status(200).json({ ok: true, data })
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) })
  }
}
