// /app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import { commitAndBuild } from "@/lib/ndjc/generator";

// 与 generator.ts 对齐的类型
type ApplyFile = { path: string; content: string; base64?: boolean };

/**
 * 临时占位的“差量注入器”——为了先验证闭环：
 * 1) 一定会在 app/src/main/assets/ 下写入一个 ndjc_<ts>.txt
 * 2) requests/*.json 与 apply.log 会同步生成
 * 之后可用你自己的 GROQ→模板差量逻辑替换这里的实现
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

  // 1) 这里构建差量文件清单（可替换为你的 GROQ → 差量注入结果）
  const files = await buildDiffFilesFromGroq({ prompt, template, appName });

  // 2) 先落盘并写入 requests/*，随后触发构建
  const { requestId } = await commitAndBuild({
    owner: process.env.GH_OWNER!,               // e.g. "why459097630"
    repo: process.env.PACKAGING_REPO!,          // e.g. "Packaging-warehouse"
    branch: process.env.PACKAGING_BRANCH || "main",
    files,
    meta: { prompt, template, appName },
    githubToken: process.env.GH_TOKEN!,         // 细粒度 token / PAT
  });

  return NextResponse.json({ ok: true, requestId });
}
