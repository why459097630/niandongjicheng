import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from '@octokit/rest';

type Ok = { ok: true; repo: string; ref: string; commitSha: string; files: string[] };
type Err = { ok: false; error: string; detail?: any };

const VALID_TEMPLATES = new Set(['core-template','form-template','simple-template']);

const owner  = process.env.GITHUB_OWNER!;
const repo   = process.env.GITHUB_REPO!;
const branch = process.env.GITHUB_BRANCH || 'main';
const token  = process.env.GH_TOKEN!;
const apiSecret = process.env.X_API_SECRET || process.env.API_SECRET;

function bad(res: NextApiResponse<Err>, code: number, msg: string, detail?: any) {
  return res.status(code).json({ ok: false, error: msg, detail });
}

function b64(s: string) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function escXml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

// 生成一个“内容包”（Java 版 Activity，无需 Kotlin 插件）
function buildContentPack(template: string, prompt: string) {
  const ts = new Date().toISOString().replace(/[:-]/g,'').replace(/\..*$/,'');
  const appId = 'com.app.generated'; // 与模板 build.gradle 默认一致；如你在 CI 用 APP_ID 会覆盖
  const base = 'content_pack/app';

  const files: { path: string; content: string }[] = [
    {
      path: `${base}/src/main/AndroidManifest.xml`,
      content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application
      android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher"
      android:theme="@style/Theme.AppCompat.Light.NoActionBar">
    <activity android:name="com.app.generated.MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`
    },
    {
      path: `${base}/src/main/java/com/app/generated/MainActivity.java`,
      content: `package com.app.generated;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_generated);
  }
}`
    },
    {
      path: `${base}/src/main/res/layout/activity_generated.xml`,
      content: `<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent"
  android:layout_height="match_parent">
  <LinearLayout
    android:orientation="vertical"
    android:padding="16dp"
    android:layout_width="match_parent"
    android:layout_height="wrap_content">

    <TextView
      android:id="@+id/title"
      android:text="@string/app_name"
      android:textSize="20sp"
      android:textStyle="bold"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"/>

    <TextView
      android:id="@+id/content"
      android:text="@string/generated_text"
      android:layout_marginTop="12dp"
      android:textSize="16sp"
      android:lineSpacingExtra="4dp"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"/>
  </LinearLayout>
</ScrollView>`
    },
    {
      path: `${base}/src/main/res/values/strings_generated.xml`,
      content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">Generated App</string>
  <string name="generated_text">${escXml(prompt)}</string>
</resources>`
    },
    {
      path: `${base}/src/main/assets/content.json`,
      content: JSON.stringify({ prompt, template, createdAt: new Date().toISOString() }, null, 2)
    },
    {
      path: `${base}/src/main/assets/build_marker_${ts}.json`,
      content: JSON.stringify({
        ok: true,
        template,
        prompt,
        createdAt: new Date().toISOString(),
        files_written: [
          'src/main/AndroidManifest.xml',
          'src/main/java/com/app/generated/MainActivity.java',
          'src/main/res/layout/activity_generated.xml',
          'src/main/res/values/strings_generated.xml',
          'src/main/assets/content.json'
        ]
      }, null, 2)
    }
  ];

  return { files, ts };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Ok|Err>) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','content-type,x-api-secret');
    res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
    return res.status(204).end();
  }
  res.setHeader('Access-Control-Allow-Origin','*');

  if (req.method !== 'POST') return bad(res,405,'Method not allowed');

  // 鉴权
  if (!apiSecret || req.headers['x-api-secret'] !== apiSecret) {
    return bad(res,401,'Unauthorized');
  }

  // 解析
  let body: any;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return bad(res,400,'Invalid JSON'); }

  const template = String(body?.template || '').trim();
  const prompt   = String(body?.prompt   || '').trim();
  if (!VALID_TEMPLATES.has(template)) return bad(res,400,'invalid template');
  if (prompt.length < 10) return bad(res,400,'prompt too short (>=10)');

  // GitHub 客户端
  if (!owner || !repo || !token) return bad(res,500,'missing GitHub env');
  const gh = new Octokit({ auth: token });

  try {
    // 读取分支 head 与 tree
    const { data: ref } = await gh.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const headSha = ref.object.sha;
    const { data: headCommit } = await gh.git.getCommit({ owner, repo, commit_sha: headSha });
    const baseTree = headCommit.tree.sha;

    // 组装内容包
    const { files, ts } = buildContentPack(template, prompt);

    // 创建 blobs
    const blobs = await Promise.all(files.map(async f => {
      const { data } = await gh.git.createBlob({ owner, repo, content: b64(f.content), encoding: 'base64' });
      return { path: f.path, sha: data.sha, mode: '100644' as const, type: 'blob' as const };
    }));

    // 创建 tree
    const { data: tree } = await gh.git.createTree({
      owner, repo, base_tree: baseTree, tree: blobs
    });

    // 创建 commit（原子）
    const message = `content-pack: ${template} | ${ts}`;
    const { data: commit } = await gh.git.createCommit({
      owner, repo, message, tree: tree.sha, parents: [headSha]
    });

    // 移动 ref
    await gh.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha, force: false });

    return res.status(200).json({
      ok: true,
      repo: `${owner}/${repo}`,
      ref: branch,
      commitSha: commit.sha,
      files: files.map(f => f.path)
    });
  } catch (e: any) {
    return bad(res,500,'push failed', e?.response?.data || String(e));
  }
}
