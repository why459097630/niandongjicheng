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

    // 1) 生成锚点补丁 JSON
    const plan = await generatePlan({ prompt, appName, packageName });

    // 2) 直接透传文件列表
    const edits = plan.files as any[];

    // 3) 提交改动
    await commitEdits(edits, `NDJC: apply plan for "${plan.appName}"`);

    // 4) 写入 requestId 文件触发构建
    const requestId = newId();
    await touchRequestFile(requestId, {
      appName: plan.appName,
      packageName: plan.packageName,
    });

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
