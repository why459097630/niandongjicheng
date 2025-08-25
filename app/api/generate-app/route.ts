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
    if (!prompt) return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });

    // 1) 生成“锚点补丁 JSON”（先用内置规则，之后可换成 Groq）
    const plan = await generatePlan({ prompt, appName, packageName });

    // 2) 把 JSON 转成仓库编辑操作
    const edits = plan.files.map(f => {
      if (f.mode === "patch") return f;
      return { ...f, content: f.content ?? (f.contentBase64 ? Buffer.from(f.contentBase64, "base64").toString("utf8") : "") };
    }) as any[];

    // 3) 先提交文件改动
    await commitEdits(edits, `NDJC: apply plan for "${plan.appName}"`);

    // 4) 写入 requests/<id>.json 触发构建
    const requestId = newId();
    await touchRequestFile(requestId, { appName: plan.appName, packageName: plan.packageName });

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
