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

    // 1) 生成锚点补丁 JSON（可先用内置规则，后续换 LLM）
    const plan = await generatePlan({ prompt, appName, packageName });

    // 2) 直接把文件列表透传给提交器（github-writer 内部处理 content/contentBase64/patch）
    const edits = plan.files as any[];

    // 3) 提交改动到 Packaging-warehouse
    await commitEdits(edits, `NDJC: apply plan for "${plan.appName}"`);

    // 4) 写入 requestId 触发构建
    const requestId = newId();
    await touchRequestFile(requestId, {
      appName: plan.appName,
      packageName: plan.packageName,
    });

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    // 打印到 Vercel Function Logs，方便定位
    console.error("NDJC generate-app error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
