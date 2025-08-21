// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { Octokit } from '@octokit/rest'
import { Buffer } from 'buffer'

type Payload = {
  appName?: string
  packageName?: string // e.g. "com.ndjc.generated"
  template?: 'core-template' | 'form-template' | 'simple-template'
  // 这里可以继续扩展你的“业务页面/图片/文案”等数据结构
}

function b64(content: string) {
  return Buffer.from(content, 'utf8').toString('base64')
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
    const secret = req.headers['x-api-secret']
    if (!secret || secret !== process.env.X_API_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' })
    }

    const body: Payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const appName = body.appName?.trim() || 'NDJC App'
    const packageName = (body.packageName || 'com.ndjc.generated').replace(/[^a-zA-Z0-9_.]/g, '')
    const branch = process.env.GH_BRANCH || 'main'
    const owner = process.env.GH_OWNER!
    const repo = process.env.GH_REPO!
    const token = process.env.GH_TOKEN!

    if (!owner || !repo || !token) {
      return res.status(500).json({ ok: false, error: 'Missing GH env: GH_OWNER/GH_REPO/GH_TOKEN' })
    }

    const octokit = new Octokit({ auth: token })

    // 生成一个最小可编译的内容包（你可把下列文件替换为 LLM 产生的业务代码）
    // 最终写入到 content_pack/app/ 目录，后续工作流会把它注入 app/
    const pkgPath = packageName.replace(/\./g, '/')
    const root = 'content_pack/app'

    const files: Array<{ path: string; content: string }> = [
      {
        path: `${root}/src/main/AndroidManifest.xml`,
        content: `<?xml version="1.0" encoding="utf-8"?>
<manifest package="${packageName}" xmlns:android="http://schemas.android.com/apk/res/android">
  <application
      android:label="${appName}"
      android:icon="@mipmap/ic_launcher"
      android:allowBackup="true"
      android:supportsRtl="true"
      android:theme="@style/Theme.MaterialComponents.DayNight.NoActionBar">
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`
      },
      {
        path: `${root}/src/main/java/${pkgPath}/MainActivity.java`,
        content: `package ${packageName};

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;
import android.widget.TextView;
import android.widget.ScrollView;
import android.widget.LinearLayout;

public class MainActivity extends AppCompatActivity {
  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    ScrollView sv = new ScrollView(this);
    LinearLayout ll = new LinearLayout(this);
    ll.setOrientation(LinearLayout.VERTICAL);
    TextView tv = new TextView(this);
    tv.setText("Hello from content pack! App: ${appName}\\nPackage: ${packageName}\\n\\n这里可以把你的业务页/组件渲染出来。");
    tv.setTextSize(18f);
    int pad = (int)(16 * getResources().getDisplayMetrics().density);
    tv.setPadding(pad, pad, pad, pad);
    ll.addView(tv);
    sv.addView(ll);
    setContentView(sv);
  }
}`
      },
      {
        path: `${root}/src/main/res/values/strings.xml`,
        content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">${appName}</string>
</resources>`
      },
      // 最小化资源，图标资源保持沿用模板里的 mipmap/ic_launcher
      { path: `${root}/.marker`, content: `generated:${Date.now()}` }
    ]

    // 读取 HEAD，构建一个 tree 一次性提交，避免多文件多次请求超限
    const { data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
    const baseSha = baseRef.object.sha

    // 先把文件转为 tree entries
    const { data: tree } = await octokit.git.createTree({
      owner, repo,
      base_tree: baseSha,
      tree: files.map(f => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        content: f.content
      }))
    })

    const commitMsg = `content-pack: ${appName} (${packageName})`
    const { data: commit } = await octokit.git.createCommit({
      owner, repo,
      message: commitMsg,
      tree: tree.sha,
      parents: [baseSha],
      author: { name: 'ndjc-bot', email: 'ndjc-bot@example.com' }
    })

    await octokit.git.updateRef({
      owner, repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
      force: false
    })

    return res.status(200).json({ ok: true, commit: commit.sha, packageName, appName })
  } catch (e: any) {
    console.error(e)
    return res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
}
