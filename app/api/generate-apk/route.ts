// app/api/generate-apk/route.ts
import { NextResponse } from "next/server";
import { Octokit } from "octokit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const {
  GITHUB_TOKEN,
  GITHUB_OWNER,
  GITHUB_REPO,
  DEFAULT_BRANCH = "main",
} = process.env;

// ---- 懒校验：在真正处理请求时才检查 env，并构造 Octokit ----
function getEnvOrThrow() {
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error(
      "Missing env: GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO. Please configure in Vercel."
    );
  }
  return {
    owner: GITHUB_OWNER as string,
    repo: GITHUB_REPO as string,
    branch: DEFAULT_BRANCH,
    octokit: new Octokit({ auth: GITHUB_TOKEN }),
  };
}

type Mode = "100644" | "100755" | "040000" | "160000" | "120000";
type ItemType = "blob" | "tree" | "commit";

type TreeItem = {
  path: string;
  mode: Mode;
  type: ItemType;
  sha?: string;
  content?: string;
};

type ReqFile = { path: string; content: string };
type ReqBody = {
  prompt?: string;
  template?: "core-template" | "form-template" | "simple-template";
  files?: ReqFile[];
};

export async function POST(req: Request) {
  try {
    const body = (await safeJson<ReqBody>(req)) ?? {};
    const { prompt, template, files: inputFiles } = body;

    const files = inputFiles?.length ? inputFiles : makeDefaultFiles(prompt, template);

    // 只有在真正要写入 GitHub 时才取 env / 构造 octokit
    const { owner, repo, branch, octokit } = getEnvOrThrow();

    const { headSha, baseTreeSha } = await getHeadAndBaseTree(octokit, owner, repo, branch);

    const tree: TreeItem[] = [];
    for (const f of files) {
      const sha = await createBlob(octokit, owner, repo, f.content);
      tree.push({ path: f.path, mode: "100644", type: "blob", sha });
    }

    const applyLogSha = await createBlob(
      octokit,
      owner,
      repo,
      [
        `prompt: ${prompt ?? "(none)"}`,
        `template: ${template ?? "(none)"}`,
        ...files.map((f) => `file: ${f.path} (${f.content.length} bytes)`),
        `time: ${new Date().toISOString()}`,
      ].join("\n")
    );
    tree.push({
      path: `app/src/main/assets/ndjc_${Date.now()}.txt`,
      mode: "100644",
      type: "blob",
      sha: applyLogSha,
    });

    const newTree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree,
    });

    const message =
      `NDJC: apply ${new Date().toISOString()} ` + files.map((f) => f.path).join(", ");
    const newCommit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.data.sha,
      parents: [headSha],
    });

    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.data.sha,
      force: false,
    });

    return NextResponse.json(
      { ok: true, commit: newCommit.data.sha, branch, wrote: files.map((f) => f.path) },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/generate-apk] failed:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

/* ---------- utils ---------- */
async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function makeDefaultFiles(prompt?: string): ReqFile[] {
  const idsXml = `<resources>
    <item name="ndjcPrimary" type="id"/>
    <item name="ndjcTitle" type="id"/>
    <item name="ndjcBody" type="id"/>
</resources>`.trim();

  const layoutXml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">
    <TextView
        android:id="@+id/ndjcTitle"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="NDJC App"
        android:textSize="22sp"
        android:textStyle="bold"
        android:paddingBottom="12dp"/>
    <TextView
        android:id="@+id/ndjcBody"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="${(prompt ?? "这是一个演示布局。").replace(/"/g, "'")}"
        android:textSize="16sp"
        android:paddingBottom="16dp"/>
    <Button
        android:id="@+id/ndjcPrimary"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Get Started"/>
</LinearLayout>`.trim();

  return [
    { path: "app/src/main/res/values/ids.xml", content: idsXml },
    { path: "app/src/main/res/layout/activity_main.xml", content: layoutXml },
    { path: `app/src/main/assets/ndjc_request_${Date.now()}.txt`, content: prompt ?? "" },
  ];
}

async function getHeadAndBaseTree(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
) {
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const headSha = ref.data.object.sha;
  const commit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: headSha });
  return { headSha, baseTreeSha: commit.data.tree.sha };
}

async function createBlob(octokit: Octokit, owner: string, repo: string, content: string) {
  const blob = await octokit.rest.git.createBlob({
    owner,
    repo,
    content,
    encoding: "utf-8",
  });
  return blob.data.sha;
}
