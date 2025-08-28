// app/api/generate-apk/route.ts
import { NextResponse } from "next/server";
import { Octokit } from "octokit";

// 这两个声明避免 Next 在 Edge Runtime 下运行（octokit 依赖 Node）
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 约定的环境变量 */
const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  DEFAULT_BRANCH = "main",
} = process.env;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  // 在启动时就抛出，避免部署后才发现
  throw new Error(
    "Missing env: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO. Please configure in Vercel."
  );
}

/** Git 树条目严格类型（修复 TS 字面量联合类型报错） */
type Mode = "100644" | "100755" | "040000" | "160000" | "120000";
type ItemType = "blob" | "tree" | "commit";

type TreeItem = {
  path: string;
  mode: Mode; // 对文件用 "100644"
  type: ItemType; // 文件用 "blob"
  sha?: string; // 引用 blob
  content?: string; // 或直写内容（两者二选一）
};

type ReqFile = {
  path: string;
  content: string;
};

type ReqBody = {
  prompt?: string;
  template?: "core-template" | "form-template" | "simple-template";
  files?: ReqFile[];
};

const octokit = new Octokit({ auth: GITHUB_TOKEN });

export async function POST(req: Request) {
  try {
    const body = (await safeJson<ReqBody>(req)) ?? {};
    const { files: inputFiles, prompt, template } = body;

    // 1) 组装要写入的文件（如果调用方没传，就给默认样例）
    const files: ReqFile[] =
      inputFiles && inputFiles.length
        ? inputFiles
        : makeDefaultFiles(prompt, template);

    // 2) 读取当前 HEAD & base tree
    const { headSha, baseTreeSha } = await getHeadAndBaseTree(
      GITHUB_OWNER!,
      GITHUB_REPO!,
      DEFAULT_BRANCH
    );

    // 3) 逐个创建 blob，收集到严格类型的 tree
    const tree: TreeItem[] = [];
    for (const f of files) {
      const sha = await createBlob(GITHUB_OWNER!, GITHUB_REPO!, f.content);
      tree.push({
        path: f.path,
        mode: "100644",
        type: "blob",
        sha,
      });
    }

    // 额外写一个 apply log，便于追踪（你也可以不写）
    const applyLogContent = [
      `prompt: ${prompt ?? "(none)"}`,
      `template: ${template ?? "(none)"}`,
      `files:`,
      ...files.map((f) => `- ${f.path} (${f.content.length} bytes)`),
      `time: ${new Date().toISOString()}`,
    ].join("\n");

    const applyLogSha = await createBlob(
      GITHUB_OWNER!,
      GITHUB_REPO!,
      applyLogContent
    );
    tree.push({
      path: `app/src/main/assets/ndjc_${Date.now()}.txt`,
      mode: "100644",
      type: "blob",
      sha: applyLogSha,
    });

    // 4) 创建新的 tree
    const newTree = await octokit.rest.git.createTree({
      owner: GITHUB_OWNER!,
      repo: GITHUB_REPO!,
      base_tree: baseTreeSha,
      tree,
    });

    // 5) 创建 commit
    const message =
      `NDJC: apply ${new Date().toISOString()} ` +
      files.map((f) => f.path).join(", ");
    const newCommit = await octokit.rest.git.createCommit({
      owner: GITHUB_OWNER!,
      repo: GITHUB_REPO!,
      message,
      tree: newTree.data.sha,
      parents: [headSha],
    });

    // 6) 推进分支引用（触发你的 Android 工作流）
    await octokit.rest.git.updateRef({
      owner: GITHUB_OWNER!,
      repo: GITHUB_REPO!,
      ref: `heads/${DEFAULT_BRANCH}`,
      sha: newCommit.data.sha,
      force: false,
    });

    return NextResponse.json(
      {
        ok: true,
        commit: newCommit.data.sha,
        branch: DEFAULT_BRANCH,
        wrote: files.map((f) => f.path),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/generate-apk] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}

/* ----------------------- 工具函数 ----------------------- */

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 默认的 3 个文件（ids.xml / activity_main.xml / 日志） */
function makeDefaultFiles(
  prompt?: string,
  template?: string
): ReqFile[] {
  const idsXml = `<resources>
    <item name="ndjcPrimary" type="id"/>
    <item name="ndjcTitle" type="id"/>
    <item name="ndjcBody" type="id"/>
</resources>
`.trim();

  const layoutXml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

    <!-- header -->
    <TextView
        android:id="@+id/ndjcTitle"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="NDJC App"
        android:textSize="22sp"
        android:textStyle="bold"
        android:paddingBottom="12dp"/>

    <!-- body -->
    <TextView
        android:id="@+id/ndjcBody"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${(prompt ?? "这是一个演示布局。").replace(/"/g, "'")}"
        android:textSize="16sp"
        android:paddingBottom="16dp"/>

    <!-- actions -->
    <Button
        android:id="@+id/ndjcPrimary"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Get Started"/>
</LinearLayout>
`.trim();

  return [
    {
      path: "app/src/main/res/values/ids.xml",
      content: idsXml,
    },
    {
      path: "app/src/main/res/layout/activity_main.xml",
      content: layoutXml,
    },
    {
      path: `app/src/main/assets/ndjc_request_${Date.now()}.txt`,
      content: JSON.stringify({ prompt, template }, null, 2),
    },
  ];
}

/** 获取 HEAD/Tree */
async function getHeadAndBaseTree(
  owner: string,
  repo: string,
  branch = "main"
): Promise<{ headSha: string; baseTreeSha: string }> {
  const ref = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const headSha = ref.data.object.sha;

  const commit = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: headSha,
  });
  const baseTreeSha = commit.data.tree.sha;
  return { headSha, baseTreeSha };
}

/** 创建 blob，返回 sha */
async function createBlob(
  owner: string,
  repo: string,
  content: string
): Promise<string> {
  const blob = await octokit.rest.git.createBlob({
    owner,
    repo,
    content,
    encoding: "utf-8",
  });
  return blob.data.sha;
}
