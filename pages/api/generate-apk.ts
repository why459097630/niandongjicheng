// /pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from 'octokit';

type ReqBody = {
  template: 'core-template' | 'form-template' | 'simple-template';
  prompt: string;
};

function b64(s: string) {
  return Buffer.from(s, 'utf8').toString('base64');
}

function sanitizeText(t: string) {
  return t.replace(/[^\S\r\n]+/g, ' ').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  const secret = req.headers['x-api-secret'] || req.headers['X-API-SECRET'];
  if (!secret || secret !== process.env.X_API_SECRET) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const { template, prompt } = req.body as ReqBody;
  if (!template || !prompt) return res.status(400).json({ ok: false, error: 'template & prompt required' });

  const GH_TOKEN = process.env.GH_TOKEN!;
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!GH_TOKEN || !owner || !repo) {
    return res.status(500).json({ ok: false, error: 'server not configured: GH_TOKEN/GITHUB_OWNER/GITHUB_REPO' });
  }

  // ====== 1) 准备业务文案（此处示例：直接用 prompt 做正文；你可替换为真实 LLM 调用）======
  const bodyText = sanitizeText(prompt);
  const title = 'Generated App';
  const pkg = 'com.app.generated'; // 与模板 build.gradle 中 applicationId/namespace 一致

  // ====== 2) 构造 content_pack 目录结构（与工作流“注入步骤”契合）======
  const ts = new Date().toISOString().replace(/[:.]/g, '');
  const packRoot = 'content_pack';
  const files: { path: string; content: string }[] = [];

  // MainActivity.java（直接放在业务包路径下）
  const javaPath = `${packRoot}/app/src/main/java/${pkg.replace(/\./g, '/')}/generated/MainActivity.java`;
  files.push({
    path: javaPath,
    content: `package ${pkg}.generated;

import android.os.Bundle;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_generated);

    TextView tv = findViewById(R.id.generated_text);
    tv.setText(getString(R.string.generated_body));
  }
}
`,
  });

  // 布局
  files.push({
    path: `${packRoot}/app/src/main/res/layout/activity_generated.xml`,
    content: `<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView
      android:id="@+id/generated_text"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:textAppearance="?android:attr/textAppearanceMedium"
      android:padding="16dp"
      android:lineSpacingExtra="2dp"/>
</ScrollView>`,
  });

  // 文案
  files.push({
    path: `${packRoot}/app/src/main/res/values/strings_generated.xml`,
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="generated_title">${title}</string>
  <string name="generated_body">${bodyText}</string>
</resources>`,
  });

  // 标记文件（硬闸用）
  files.push({
    path: `${packRoot}/app/src/main/assets/build_marker_${ts}.json`,
    content: JSON.stringify(
      {
        ok: true,
        template,
        commitMsg: `apk: ${template} | ${ts}`,
        package: pkg,
        marker: ts,
      },
      null,
      2,
    ),
  });

  // ====== 3) 用 Git Data API 做“一个 commit”原子提交 ======
  const octokit = new Octokit({ auth: GH_TOKEN });

  // 当前分支 ref
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const baseSha = ref.data.object.sha;

  // base tree
  const baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: baseSha });
  const baseTree = baseCommit.data.tree.sha;

  // 创建 blobs
  const blobs = await Promise.all(
    files.map(async f => {
      const blob = await octokit.rest.git.createBlob({
        owner,
        repo,
        content: f.content,
        encoding: 'utf-8',
      });
      return { path: f.path, sha: blob.data.sha };
    }),
  );

  // 创建 tree
  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTree,
    tree: blobs.map(b => ({
      path: b.path,
      mode: '100644',
      type: 'blob' as const,
      sha: b.sha,
    })),
  });

  // 创建 commit
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `content-pack: ${template} | ${ts}`,
    tree: tree.data.sha,
    parents: [baseSha],
  });

  // 更新分支指向
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
    force: false,
  });

  return res.status(200).json({
    ok: true,
    repo,
    branch,
    commit: commit.data.sha,
    files: files.map(f => f.path),
  });
}
