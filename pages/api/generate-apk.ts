// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Octokit } from '@octokit/rest';

const REPO = process.env.GH_REPO!;      // e.g. why459097630/Packaging-warehouse
const BRANCH = process.env.GH_BRANCH || 'main';
const GH_PAT = process.env.GH_PAT!;
const API_SECRET = process.env.X_API_SECRET!;  // 与仓库Secrets一致

// 目标目录（工作流门槛检查的路径）
const BASE_DIR = 'content_pack/app';

const filesToCommit = (pkgName: string) => {
  const pkgPath = pkgName.replace(/\./g, '/');
  const mainKt = `package ${pkgName}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContent {
      Text(text = "Hello from content pack!")
    }
  }
}
`;

  const layoutXml = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
  xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto"
  android:layout_width="match_parent"
  android:layout_height="match_parent">
</androidx.constraintlayout.widget.ConstraintLayout>`;

  return [
    {
      path: `${BASE_DIR}/src/main/java/${pkgPath}/MainActivity.kt`,
      content: mainKt
    },
    {
      path: `${BASE_DIR}/src/main/res/layout/activity_main.xml`,
      content: layoutXml
    }
  ];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // 1) 校验密钥
    const secret = req.headers['x-api-secret'] || req.query.secret;
    if (!secret || secret !== API_SECRET) {
      return res.status(401).json({ ok: false, message: 'invalid secret' });
    }

    // 2) 解析需求（模板/包名/提示词等）——这里给默认值
    const { packageName = 'com.ndjc.generated' } = (req.body || {}) as any;

    const octokit = new Octokit({ auth: GH_PAT });
    const [owner, repo] = REPO.split('/');

    // 3) 获取分支最新 commit & tree，用树 API 批量提交
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${BRANCH}` });
    const latestCommitSha = ref.object.sha;

    const { data: commit } = await octokit.git.getCommit({ owner, repo, commit_sha: latestCommitSha });
    const baseTree = commit.tree.sha;

    // 4) 组装树条目（注意换行 & utf8 -> base64 由API帮我们做）
    const tree = filesToCommit(packageName).map(f => ({
      path: f.path,
      mode: '100644',
      type: 'blob' as const,
      content: f.content
    }));

    const { data: newTree } = await octokit.git.createTree({
      owner, repo, tree, base_tree: baseTree
    });

    // 5) 新提交
    const commitMessage = `chore(content-pack): inject MainActivity & layout via API`;
    const { data: newCommit } = await octokit.git.createCommit({
      owner, repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha]
    });

    // 6) 移动分支指针
    await octokit.git.updateRef({
      owner, repo,
      ref: `heads/${BRANCH}`,
      sha: newCommit.sha,
      force: false
    });

    return res.status(200).json({ ok: true, committed: tree.map(t => t.path) });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e?.message || 'unknown error' });
  }
}
