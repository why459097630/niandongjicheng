// app/api/generate-apk/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from 'octokit';

// 运行在 Node（非 Edge），避免某些 Node-only API 受限
export const runtime = 'nodejs';

type FileSpec = {
  path: string;                 // 例如: "app/src/main/res/layout/activity_main.xml"
  content: string;              // 纯文本内容（默认按 utf-8 处理）
  encoding?: 'utf-8' | 'base64' // 可选，默认 'utf-8'
};

function b64(s: string) {
  return Buffer.from(s, 'utf8').toString('base64');
}

export async function POST(req: NextRequest) {
  // 1) 简单鉴权（与现有一致）
  if (req.headers.get('x-api-secret') !== process.env.X_API_SECRET) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Bad JSON body' }, { status: 400 });
  }

  // 2) 读取参数（默认值按你仓库来）
  const {
    owner = process.env.GH_OWNER ?? 'why459097630',
    repo  = process.env.GH_REPO  ?? 'Packaging-warehouse',
    branch = process.env.GH_BRANCH ?? 'main',

    // 由“API 编排器/代码生成器”最终汇总后的文件清单
    files,
    // 可选：额外拼进提交信息尾巴，方便在 Actions 列表里辨识
    messageSuffix = '',
    // 可选：runId 用于日志文件命名；不传就用时间戳
    runId = `ndjc_${Date.now()}`
  } = body as {
    owner?: string;
    repo?: string;
    branch?: string;
    files: FileSpec[];
    messageSuffix?: string;
    runId?: string;
  };

  if (!Array.isArray(files) || files.length === 0) {
    return NextResponse.json({ ok: false, error: 'files[] required' }, { status: 400 });
  }

  // 3) GitHub Token（与原逻辑保持一致的 env 名称；任选其一）
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'GITHUB_TOKEN (or GH_TOKEN) missing' }, { status: 500 });
  }

  const octokit = new Octokit({ auth: token });

  try {
    // 4) 读取分支 head 提交
    const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const latestCommitSha = ref.data.object.sha;

    const latestCommit = await octokit.rest.git.getCommit({
      owner, repo, commit_sha: latestCommitSha
    });
    const baseTreeSha = latestCommit.data.tree.sha;

    // 5) 为每个文件创建 blob（一次性写入，不再拆多次提交）
    const blobs = await Promise.all(
      files.map(async (f) => {
        const contentBase64 =
          f.encoding === 'base64' ? f.content : Buffer.from(f.content, 'utf8').toString('base64');

        const blob = await octokit.rest.git.createBlob({
          owner, repo,
          content: contentBase64,
          encoding: 'base64'
        });

        return {
          path: f.path,
          mode: '100644',
          type: 'blob' as const,
          sha: blob.data.sha
        };
      })
    );

    // 6) 在同一个提交里附带一份“apply 日志文件”（不再额外 commit）
    const applyLog = {
      runId,
      files: files.map(f => f.path),
      ts: new Date().toISOString()
    };
    const logBlob = await octokit.rest.git.createBlob({
      owner, repo,
      content: b64(JSON.stringify(applyLog, null, 2)),
      encoding: 'base64'
    });
    blobs.push({
      path: `app/src/main/assets/${runId}.json`,
      mode: '100644',
      type: 'blob',
      sha: logBlob.data.sha
    });

    // 7) 基于 base tree 创建新 tree
    const tree = await octokit.rest.git.createTree({
      owner, repo,
      base_tree: baseTreeSha,
      tree: blobs
    });

    // 8) 创建**唯一**一次提交（不再有 request/plan/apply.log 的中间提交）
    const commitMessage = `NDJC:${runId} apply ${messageSuffix}`.trim();
    const newCommit = await octokit.rest.git.createCommit({
      owner, repo,
      message: commitMessage,
      tree: tree.data.sha,
      parents: [latestCommitSha]
    });

    // 9) 更新分支引用到这次提交（触发一次 Actions）
    await octokit.rest.git.updateRef({
      owner, repo,
      ref: `heads/${branch}`,
      sha: newCommit.data.sha,
      force: true
    });

    return NextResponse.json({
      ok: true,
      runId,
      committed: files.map(f => f.path).concat(`app/src/main/assets/${runId}.json`),
      commitSha: newCommit.data.sha,
      commitMessage
    });
  } catch (err: any) {
    console.error('[NDJC] atomic commit failed:', err?.message || err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
