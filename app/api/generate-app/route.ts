// /app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  resolveWithDefaults,
  makeSimpleTemplateFiles,
  commitAndBuild,
} from "@/lib/ndjc/generator";

/**
 * （可选增强）尝试获取最近一次 workflow_dispatch 的运行链接。
 * 若瞬时拿不到，会返回 undefined，调用方应兜底到 Actions 列表页。
 */
async function getLatestWorkflowRunUrl(
  workflowFile: string,
  ref: string,
): Promise<string | undefined> {
  // 需要和 generator.ts 使用的环境变量一致
  const owner = process.env.GITHUB_OWNER!;
  const repo = process.env.GITHUB_REPO!;
  const token = process.env.GITHUB_TOKEN!;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs?branch=${encodeURIComponent(
    ref,
  )}&event=workflow_dispatch&per_page=1`;

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "ndjc",
    },
    // 给 GitHub 一点时间生成 run；不是必须，也可以去掉
    // @ts-ignore
    next: { revalidate: 0 },
  });

  if (!r.ok) return undefined;
  const j: any = await r.json();
  const run = j?.workflow_runs?.[0];
  return run?.html_url as string | undefined;
}

export async function POST(req: NextRequest) {
  try {
    // 1) 前端/GROQ 传入的参数
    const body = await req.json();
    const params = resolveWithDefaults(body?.params || {});

    // 2) 生成需要提交到打包仓库的文件（simple 模板；core/form 可做各自的 maker）
    const files = makeSimpleTemplateFiles(params);

    // 3) 真推送 + 触发打包
    //    - workflow 文件名若不是 android-build-matrix.yml，请替换为实际名称
    const branch = process.env.GITHUB_BRANCH || "main";
    const workflowFile = "android-build-matrix.yml";

    const { ok, writtenCount, note } = await commitAndBuild({
      files,
      message: `NDJC: ${params.NDJC_APP_NAME} – automated commit`,
      workflowFile,
      ref: branch,
    });

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "commitAndBuild returned not ok" },
        { status: 500 },
      );
    }

    // 4) 返回可用的构建链接
    const owner = process.env.GITHUB_OWNER!;
    const repo = process.env.GITHUB_REPO!;
    const fallbackActionsUrl = `https://github.com/${owner}/${repo}/actions`;

    // 可选增强：尽力拿最近一次 run 的直达链接
    const runUrl =
      (await getLatestWorkflowRunUrl(workflowFile, branch)) ||
      fallbackActionsUrl;

    return NextResponse.json({
      ok: true,
      writtenCount,
      note,            // "pushed to GitHub & workflow dispatched"
      actionsUrl: runUrl,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 },
    );
  }
}
