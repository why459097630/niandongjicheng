// app/api/generate-apk/route.ts
// Next.js Route Handler（Node.js runtime）
// - 调用 generateWithAudit 生成/落盘日志
// - 读取本地生成的日志与摘要并 push 到 GitHub
// - 触发工作流
// - 回传详细的 env/dispatch/error 便于线上排障

import { NextResponse } from "next/server";
import {
  generateWithAudit,
  commitAndBuild,
  readText,                 // 读取仓库内相对路径文件
  type FileSpec,
} from "@/lib/ndjc/generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(v: unknown) {
  return !(v === undefined || v === null || v === "");
}

// 与生成器保持一致：默认的仓库根目录
const REPO_ROOT = process.env.PACKAGING_REPO_PATH ?? "/tmp/Packaging-warehouse";

// 读取一个相对路径；读不到就跳过
async function safeRead(rel: string): Promise<FileSpec | null> {
  try {
    const content = await readText(REPO_ROOT, rel);
    return { filePath: rel, content };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // 1) 解析前端 body（尽量宽松）
  const body: any = await req.json().catch(() => ({}));

  // 2) 生成：把原始 body 也写入 raw，便于回溯
  const gen = await generateWithAudit({
    prompt: body.prompt ?? "",
    template: body.template ?? "core-template",
    anchors: Array.isArray(body.anchors) ? body.anchors : [],
    raw: body,
    normalized: body.normalized,
  });

  // 3) 组装需要 push 到仓库的文件清单
  const reqDir = gen.requestDir; // like: requests/2025-08-31/req_169349...
  const logRelatives = [
    `${reqDir}/meta.json`,
    `${reqDir}/orchestrator.json`,
    `${reqDir}/generator.json`,
    `${reqDir}/api_response.json`,
    `${reqDir}/index.md`,
  ];

  const filesToPush: FileSpec[] = [];

  // 3.1 push APK 内的摘要
  const f1 = await safeRead(gen.assetsJsonPath);
  if (f1) filesToPush.push(f1);

  // 3.2 push 日志目录里的核心文件（不存在的自动跳过）
  for (const rel of logRelatives) {
    const f = await safeRead(rel);
    if (f) filesToPush.push(f);
  }

  // 3.3 如果前端额外传了差量文件（少见），也一并 push
  if (Array.isArray(body.files)) {
    for (const f of body.files) {
      if (f?.filePath && typeof f?.content === "string") {
        filesToPush.push({ filePath: f.filePath, content: f.content });
      }
    }
  }

  // 4) 触发 GitHub：显式把 workflowFile/ref 传入
  const dispatchInput = {
    files: filesToPush,
    message: `NDJC: ${process.env.NDJC_APP_NAME ?? "generated"} commit`,
    ref: process.env.GH_BRANCH ?? "main",
    workflowFile: process.env.WORKFLOW_ID,
  };

  // 打印关键上下文到 Vercel 日志
  console.log("[NDJC] dispatch", {
    owner: process.env.GH_OWNER,
    repo: process.env.GH_REPO,
    branch: dispatchInput.ref,
    wf: dispatchInput.workflowFile,
    files: filesToPush.length,
    buildId: gen.buildId,
  });

  let dispatch: any = null;
  let error: any = null;

  try {
    dispatch = await commitAndBuild(dispatchInput);
  } catch (e: any) {
    error = { message: e?.message ?? String(e) };
    console.error("[NDJC] commitAndBuild error:", error);
  }

  // 5) 回传：同时暴露 env 配置状态，方便排障
  const env = {
    hasOwner: ok(process.env.GH_OWNER),
    hasRepo: ok(process.env.GH_REPO),
    hasToken: ok(process.env.GH_TOKEN),
    hasWorkflow: ok(process.env.WORKFLOW_ID),
    branch: process.env.GH_BRANCH ?? "main",
  };

  const success = !error && !!dispatch?.ok;

  return NextResponse.json(
    {
      ok: success,
      env,
      dispatch, // { ok, writtenCount, note }
      error,    // { message }
      generated: {
        buildId: gen.buildId,
        requestDir: gen.requestDir,
        assetsJsonPath: gen.assetsJsonPath,
      },
    },
    { status: success ? 200 : 500 }
  );
}
