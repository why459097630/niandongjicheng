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
    const { prompt, appName, packageName, template = "form-template" } = body || {};
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
    }

    // 1) 生成计划（会返回 files 差量补丁）
    const plan = await generatePlan({ prompt, appName, packageName, template });

    // 2) 提交差量补丁（如果有）
    const edits = (plan.files ?? []) as any[];
    if (edits.length > 0) {
      await commitEdits(edits, `NDJC: apply plan for "${plan.appName}"`);
    }

    // 3) 记录请求（requests/<id> 三件套）
    const requestId = newId();
    await touchRequestFile(requestId, { kind: "plan", ...plan });
    await touchRequestFile(requestId, {
      kind: "apply",
      appName: plan.appName,
      packageName: plan.packageName,
      template,
      files: edits.map(e => e.path),
    });
    await touchRequestFile(requestId, {
      kind: "request",
      prompt,
      appName,
      packageName,
      template,
      reason: "api",
    });

    // 4) 触发构建（repository_dispatch）
    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;
    const apiBase = process.env.SITE_URL || process.env.NEXT_PUBLIC_API_BASE || "";
    const apiSecret = process.env.API_SECRET || "";

    const payload = {
      template,
      app_name: plan.appName || appName || "MyApp",
      api_base: apiBase,
      api_secret: apiSecret,
      owner,
      repo,
      branch: "main",
      version_name: "1.0.0",
      version_code: "1",
      reason: "api",
    };

    // 你现有的 dispatch 代码保持不变即可（略）
    // await dispatchBuild(payload)

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    console.error("NDJC generate-app error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
