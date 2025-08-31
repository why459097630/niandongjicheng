// app/api/generate-apk/route.ts
// Next.js Route Handler（Node.js runtime）
// - 调用 generateWithAudit 生成/落盘日志
// - 调用 commitAndBuild 推送到 GitHub + 触发工作流
// - 回传详细的 env/dispatch/error 便于线上排障

import { NextResponse } from "next/server";
import {
  generateWithAudit,
  commitAndBuild,
  // FileSpec 类型可选；若严格 TS 可启用
  // type FileSpec
} from "@/lib/ndjc/generator";

export const runtime = "nodejs";        // 确保不是 Edge（需要 Node 能力）
export const dynamic = "force-dynamic"; // 避免被静态化缓存

function ok(v: unknown) {
  return !(v === undefined || v === null || v === "");
}

export async function POST(req: Request) {
  // 1) 解析前端 body（尽量宽松）
  const body: any = await req.json().catch(() => ({}));

  // 2) 生成阶段：把原始 body 也写入 raw，便于回溯
  const gen = await generateWithAudit({
    prompt: body.prompt ?? "",
    template: body.template ?? "core-template",
    anchors: Array.isArray(body.anchors) ? body.anchors : [],
    raw: body,                    // 方便事后在 requests/* 里看见原始请求
    normalized: body.normalized,  // 如果前端有做过清洗
  });

  // 3) 触发 GitHub：显式把 workflowFile/ref 传入（不要依赖默认）
  const dispatchInput = {
    files: Array.isArray(body.files) ? body.files : [], // 前端可传差量文件；没有也能触发
    message: `NDJC: ${process.env.NDJC_APP_NAME ?? "generated"} commit`,
    ref: process.env.GH_BRANCH ?? "main",               // 分支
    workflowFile: process.env.WORKFLOW_ID,              // 关键：文件名或数字 ID
  };

  // 打印关键上下文到 Vercel 日志，便于观察
  console.log("[NDJC] dispatch", {
    owner: process.env.GH_OWNER,
    repo: process.env.GH_REPO,
    branch: dispatchInput.ref,
    wf: dispatchInput.workflowFile,
    files: dispatchInput.files?.length ?? 0,
  });

  let dispatch: any = null;
  let error: any = null;

  try {
    dispatch = await commitAndBuild(dispatchInput);
  } catch (e: any) {
    // commitAndBuild 已经把 GitHub 失败的正文 throw 出来，这里兜底回传
    error = { message: e?.message ?? String(e) };
    console.error("[NDJC] commitAndBuild error:", error);
  }

  // 4) 回传：同时暴露 env 配置状态，方便你在前端/日志里一眼看出缺啥
  const env = {
    hasOwner: ok(process.env.GH_OWNER),
    hasRepo: ok(process.env.GH_REPO),
    hasToken: ok(process.env.GH_TOKEN),          // 若为 false → Vercel 未注入 PAT
    hasWorkflow: ok(process.env.WORKFLOW_ID),    // 若为 false → 未配置工作流标识
    branch: process.env.GH_BRANCH ?? "main",
  };

  // 成功条件：commitAndBuild 返回 ok=true（即已成功 dispatch）
  const success = !error && !!dispatch?.ok;

  return NextResponse.json(
    {
      ok: success,
      env,
      dispatch,             // { ok, writtenCount, note }
      error,                // { message }（GitHub 报错会在这里）
      generated: {
        buildId: gen.buildId,
        requestDir: gen.requestDir, // 在仓库 requests/YYYY-MM-DD/<buildId> 下可查
        assetsJsonPath: gen.assetsJsonPath,
      },
    },
    { status: success ? 200 : 500 }
  );
}
