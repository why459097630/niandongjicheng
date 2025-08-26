// app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generatePlan } from "@/lib/ndjc/generator";
import { commitEdits, touchRequestFile } from "@/lib/ndjc/github-writer";

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, appName, packageName } = body || {};
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
    }

    // 1) 调用 Groq 生成锚点 JSON（若 Groq 出错会 throw，不会继续）
    const plan = await generatePlan({ prompt, appName, packageName });

    // 2) 文件差量改动（只要 Groq 成功，才会到这一步）
    const edits = plan.files as any[];

    // 3) 提交改动到 Packaging-warehouse
    await commitEdits(edits, `NDJC: apply plan for "${plan.appName}"`);

    // 4) 写 requestId 文件触发构建
    const requestId = newId();
    await touchRequestFile(requestId, {
      appName: plan.appName,
      packageName: plan.packageName,
    });

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    // 打印错误到 Vercel Function Logs
    console.error("NDJC generate-app error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Groq or commit failed" },
      { status: 500 }
    );
  }
}
