// /app/api/generate-apk/route.ts
import { NextRequest, NextResponse } from "next/server";
import { commitAndBuild } from "@/lib/ndjc/generator";

// 差量文件类型
type ApplyFile = { path: string; content: string; base64?: boolean };

/**
 * 临时差量注入器：始终生成一个 assets 文件
 * 用于验证 requests/* 和 commit 是否落盘
 */
async function buildDiffFilesFromGroq(input: {
  prompt: string;
  template?: string;
  appName?: string;
}): Promise<ApplyFile[]> {
  const ts = Date.now();
  const lines = [
    `NDJC APPLY`,
    `time=${new Date(ts).toISOString()}`,
    `appName=${input.appName || ""}`,
    `template=${input.template || ""}`,
    `prompt=${(input.prompt || "").replace(/\r?\n/g, " ")}`,
  ];
  return [
    {
      path: "app/src/main/assets/ndjc_" + ts + ".txt",
      content: lines.join("\n"),
    },
  ];
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const prompt = body.prompt || "";
  const template = body.template || "core-template";
  const appName = body.appName || "NDJCApp";

  // 1) 调用差量注入器（未来替换成 GROQ→模板差量逻辑）
  const files = await buildDiffFilesFromGroq({ prompt, template, appName });

  // 2) 落盘并写入 requests/*，再触发构建
  const { requestId } = await commitAndBuild({
    owner: process.env.GH_OWNER!,               // e.g. "why459097630"
    repo: process.env.PACKAGING_REPO!,          // e.g. "Packaging-warehouse"
    branch: process.env.PACKAGING_BRANCH || "main",
    files,
    meta: { prompt, template, appName },
    githubToken: process.env.GH_TOKEN!,         // 你的 Fine-grained Token
  });

  return NextResponse.json({ ok: true, requestId });
}
