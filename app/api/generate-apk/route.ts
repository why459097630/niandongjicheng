// /app/api/generate-apk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { commitAndBuild } from "@/lib/ndjc/generator";
import { buildDiffFilesFromGroq } from "@/lib/ndjc/diff";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    console.log("[NDJC] route hit /api/generate-apk");
    const body = await req.json();
    const prompt = body.prompt || "";
    const template = body.template || "core-template";
    const appName = body.appName || "NDJCApp";

    // 1) 由（暂时是）Prompt 构造 UI 片段 → 注入到布局
    const files = await buildDiffFilesFromGroq({ prompt, template, appName });
    console.log("[NDJC] files", files.map(f => f.path));

    // 2) 落盘并触发构建（兼容 PACKAGING_* / GH_*）
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
