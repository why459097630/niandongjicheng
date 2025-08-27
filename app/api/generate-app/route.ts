// app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generatePlan } from "@/lib/ndjc/generator";
import { commitEdits, touchRequestFile, dispatchBuild } from "@/lib/ndjc/github-writer";

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    const body = await req.json();
    const { prompt, appName, packageName, template = "form-template" } = body || {};
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
    }

    console.log("[NDJC] /generate-app input", { prompt, appName, packageName, template });

    // (1) 生成计划（差量补丁）
    const plan = await generatePlan({ prompt, appName, packageName, template });
    const edits = (plan.files ?? []) as any[];
    console.log("[NDJC] plan generated", { fileCount: edits.length });

    // (2) 提交差量补丁（如有）
    if (edits.length > 0) {
      const ok = await commitEdits(edits, `NDJC: apply plan for "${plan.appName}"`);
      console.log("[NDJC] commitEdits result", ok);
      if (!ok) throw new Error("commitEdits failed");
    } else {
      console.log("[NDJC] commitEdits skipped (no edits)");
    }

    // (3) 记录 requests/<id>*.json 三件套
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
    console.log("[NDJC] touchRequestFile all done", { requestId });

    // (4) 触发构建（repository_dispatch）
    const payload = {
      template,
      app_name: plan.appName || appName || "MyApp",
      api_base: process.env.SITE_URL || process.env.NEXT_PUBLIC_API_BASE || "",
      api_secret: process.env.API_SECRET || "",
      owner: process.env.GH_OWNER!,
      repo: process.env.GH_REPO!,
      branch: "main",
      version_name: "1.0.0",
      version_code: "1",
      reason: "api",
    };
    const d = await dispatchBuild(payload);
    console.log("[NDJC] dispatchBuild done", { status: d?.status });

    return NextResponse.json({ ok: true, requestId, costMs: Date.now() - t0 });
  } catch (e: any) {
    console.error("[NDJC] generate-app error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
