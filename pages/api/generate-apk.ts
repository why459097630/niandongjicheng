// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { Octokit } from 'octokit'

type ReqBody = {
  template?: 'simple-template' | 'form-template' | 'core-template'
  packageName?: string
  appLabel?: string
  prompt?: string // 业务文案，可用于生成内容
  commitMessage?: string
}

const {
  GH_PAT = '',
  GH_OWNER = '',
  GH_REPO = '',
  X_API_SECRET = '',
} = process.env

function b64(content: string) {
  return Buffer.from(content, 'utf8').toString('base64')
}

// 生成最小可启动的 Android 内容（满足你的硬闸：必须存在 MainActivity.java）
function genAndroidFiles({
  packageName = 'com.app.generated',
  appLabel = 'Generated App',
  prompt = 'Hello from generated app',
}: {
  packageName?: string
  appLabel?: string
  prompt?: string
}) {
  const pkgPath = packageName.replace(/\./g, '/')

  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}">
  <application
    android:label="${appLabel}"
    android:icon="@mipmap/ic_launcher">
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>`.trim()

  const mainActivity = `package ${packageName};

import android.os.Bundle;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_main);
    Toast.makeText(this, "${prompt}", Toast.LENGTH_LONG).show();
  }
}`.trim()

  const layout = `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent">
  <TextView
    android:id="@+id/hello"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="${prompt}" />
</RelativeLayout>`.trim()

  return {
    // 你的工作流检查的是这个路径是否存在
    mainActivityPath: `content_pack/app/src/main/java/${pkgPath}/MainActivity.java`,
    files: [
      {
        path: `content_pack/app/src/main/AndroidManifest.xml`,
        content: manifest,
      },
      {
        path: `content_pack/app/src/main/res/layout/activity_main.xml`,
        content: layout,
      },
      {
        path: `content_pack/app/src/main/java/${pkgPath}/MainActivity.java`,
        content: mainActivity,
      },
    ],
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, message: 'Method Not Allowed' })
      return
    }

    // 简单的接口鉴权
    const tokenFromHeader = req.headers['x-api-secret']
    if (!X_API_SECRET || tokenFromHeader !== X_API_SECRET) {
      res.status(401).json({ ok: false, message: 'Unauthorized' })
      return
    }

    if (!GH_PAT || !GH_OWNER || !GH_REPO) {
      res.status(500).json({ ok: false, message: 'Missing GH_* envs' })
      return
    }

    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as ReqBody

    const { packageName, appLabel, prompt } = body || {}
    const { files, mainActivityPath } = genAndroidFiles({ packageName, appLabel, prompt })

    const octokit = new Octokit({ auth: GH_PAT })

    // 逐个文件写入（简单直观；如需原子提交，可改用 git trees API 一次提交）
    for (const f of files) {
      await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: GH_OWNER,
        repo: GH_REPO,
        path: f.path,
        message: body?.commitMessage || `feat(content_pack): write ${f.path}`,
        content: b64(f.content),
      })
    }

    res.status(200).json({
      ok: true,
      wrote: files.map(f => f.path),
      hint: `Hard gate key file: ${mainActivityPath}`,
    })
  } catch (e: any) {
    console.error(e)
    res.status(500).json({ ok: false, message: e?.message || 'Internal Error' })
  }
}
