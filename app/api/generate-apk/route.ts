// /app/api/generate-apk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { commitAndBuild, type ApplyFile } from "@/lib/ndjc/generator";

// 需要 Node 运行时（Octokit + crypto）
export const runtime = "nodejs";

/**
 * 临时的“差量注入器”：
 * 为了验证闭环，每次在 assets/ 写一份标记文件。
 * 后续把这里替换成【GROQ → 模板注入 → files[]】即可。
 */
async function buildDiffFilesFromGroq(input: {
  prompt: string;
  template?: string;
  appName?: string;
}): Promise<ApplyFile[]> {
  const ts = Date.now();
  const lines = [
    "NDJC APPLY",
    `time=${new Date(ts).toISOString()}`,
    `appName=${input.appName || ""}`,
    `template=${input.template || ""}`,
    `prompt=${(input.prompt || "").replace(/\r?\n/g, " ")}`,
  ];
  return [
    {
      path: `app/src/main/assets/ndjc_${ts}.txt`,
      content: lines.join("\n"),
    },
  ];
}

export async function POST(req: NextRequest) {
  try {
    console.log("[NDJC] route hit /api/generate-apk");
    const body = await req.json();
    const prompt = body.prompt || "";
    const template = body.template || "core-template";
    const appName = body.appName || "NDJCApp";

    // 1) 生成差量文件清单（临时版本）
    const files = await buildDiffFilesFromGroq({ prompt, template, appName });
    console.log("[NDJC] files", files.map(f => f.path));

    // 2) 落盘并触发构建（兼容两套环境变量名）
    const owner  = process.env.GH_OWNER!;
    const repo   = process.env.PACKAGING_REPO || process.env.GH_REPO!;
    const branch = process.env.PACKAGING_BRANCH || process.env.GH_BRANCH || "main";
    const token  = process.env.GH_TOKEN!;

    if (!owner || !repo || !token) {
      throw new Error(`Missing env: GH_OWNER=${!!owner}, REPO=${repo}, GH_TOKEN=${!!token}`);
    }

    const { requestId } = await commitAndBuild({
      owner, repo, branch, files,
      meta: { prompt, template, appName },
      githubToken: token,
    });

    console.log("[NDJC] done & dispatched", requestId);
    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    console.error("[NDJC] ERROR", e?.status || "", e?.message || e);
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
