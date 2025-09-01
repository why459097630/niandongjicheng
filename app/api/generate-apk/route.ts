// app/api/generate-apk/route.ts
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readdir, stat as fsStat, readFile } from "node:fs/promises";

import {
  generateWithAudit,
  readText,
  makeSimpleTemplateFiles,
  commitAndBuild,
  type FileSpec,
} from "@/lib/ndjc/generator";

// —— 小工具：递归读取目录为 FileSpec[]（以 repoRoot 为根的相对路径）——
async function dirToFileSpecs(repoRoot: string, relDir: string): Promise<FileSpec[]> {
  const out: FileSpec[] = [];
  const abs = path.join(repoRoot, relDir);

  async function walk(rp: string) {
    const absDir = path.join(repoRoot, rp);
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = path.join(rp, ent.name).replace(/\\/g, "/");
      const absPath = path.join(repoRoot, rel);
      if (ent.isDirectory()) {
        await walk(rel);
      } else {
        const s = await fsStat(absPath);
        if (s.isFile()) {
          const content = await readFile(absPath, "utf8");
          out.push({ filePath: rel, content });
        }
      }
    }
  }

  // 如果目录不存在/为空，吞掉异常即可
  try {
    await walk(relDir);
  } catch { /* noop */ }

  return out;
}

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    // 1) 解析请求体
    const body = await req.json().catch(() => ({}));
    const {
      prompt = "",
      template = "core-template",
      anchors = [] as string[],
      appTitle = "NDJCApp",
      // 可选：前端传 buildId/branch/workflowFile 覆盖
      buildId: buildIdFromClient,
      ref: refFromClient,
      workflowFile: wfFromClient,
      // 兼容：保留扩展字段
      ...rest
    } = body || {};

    // 2) 确定可写目录（Serverless 只保证 /tmp 可写）
    const repoRoot =
      process.env.PACKAGING_REPO_PATH?.trim() ||
      "/tmp/Packaging-warehouse";

    // 3) 准备最小的模板改动（至少往 strings.xml 写个 app_name，避免 files: 0）
    const templateFiles: FileSpec[] = makeSimpleTemplateFiles({ appTitle });

    // 4) 调用生成器：会把请求归档写到 requests/YYYY-MM-DD/<buildId>，
    //    并写入 app/src/main/assets/ndjc_info.json（摘要）
    const { buildId, assetsJsonPath, requestDir } = await generateWithAudit({
      repoRoot,
      template,
      prompt,
      anchors,
      files: templateFiles,
      buildId: buildIdFromClient,   // 若外部指定 buildId 就用外部的
      extra: { from: "api/generate-apk", ...rest },
    });

    // 5) 把“这次请求目录下的所有文件 + assets 摘要 + 模板改动”打包成 FileSpec[]
    const filesFromRequest = await dirToFileSpecs(repoRoot, requestDir);
    const filesFromAssets: FileSpec[] = [{
      filePath: assetsJsonPath,
      content: await readText(repoRoot, assetsJsonPath),
    }];

    // 注意：模板改动我们已经以内存形式提交过（templateFiles），
    // 仍可和日志一起推到 GitHub，便于还原本次改动。
    const filesToCommit: FileSpec[] = [
      ...templateFiles,
      ...filesFromAssets,
      ...filesFromRequest,
    ];

    // 6) 推送到 GitHub 并触发工作流
    const ref = (refFromClient || process.env.GH_BRANCH || "main").trim();
    const workflowFile = (wfFromClient || process.env.WORKFLOW_ID || "android-build-matrix.yml").trim();

    const pushed = await commitAndBuild({
      files: filesToCommit,
      ref,
      workflowFile,
      message: `NDJC: ${process.env.NDJC_APP_NAME ?? "automated"} commit (buildId=${buildId})`,
    });

    // 7) 返回给前端
    return NextResponse.json({
      ok: true,
      tookMs: Date.now() - started,
      buildId,
      repoRoot,
      committedFiles: filesToCommit.length,
      repoPushNote: pushed?.note,
      dispatchedWorkflow: workflowFile,
      branch: ref,
      anchorsInjected: anchors,
      // 给前端快速导航的提示（仅提示，不包含机密）
      tips: {
        requestArchive: `requests/<date>/${buildId}/`,
        apkSummary: "app/src/main/assets/ndjc_info.json",
        whereToSee: [
          "GitHub 仓库：requests/<date>/<buildId>/ 里有 orchestrator/generator/api_response",
          "GitHub Actions：Artifacts 可下载 APK，assets/ndjc_info.json 里有摘要",
        ],
      },
    });

  } catch (err: any) {
    console.error("[/api/generate-apk] error:", err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
