// app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generatePlan } from "@/lib/ndjc/generator";
import { commitEdits, type FileEdit, touchRequestFile } from "@/lib/ndjc/github-writer";
import { dispatchBuild } from "@/lib/ndjc/github-writer";

function newId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { prompt, appName, packageName } = body || {};
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
    }

    const requestId = newId();
    console.log("[NDJC] start", { requestId, appName, packageName });

    // 1) 生成计划（Groq 若失败会 throw，不继续）
    const plan = await generatePlan({ prompt, appName, packageName });
    console.log("[NDJC] plan generated", { requestId, files: plan.files.length });

    // 2) 单次提交：plan.json（留痕）+ 代码改动
    const edits: FileEdit[] = [
      {
        path: `requests/${requestId}.plan.json`,
        mode: "create",
        content: JSON.stringify({ requestId, ...plan, ts: Date.now() }, null, 2),
      },
      ...(plan.files as any[]),
    ];
    const commitMsg = `NDJC:${requestId} apply plan for "${plan.appName}"`;
    const { audit, commitSha } = await commitEdits(edits, commitMsg);
    console.log("[NDJC] commit done", { requestId, commitSha });

    // 3) 写入 apply 日志
    const applyLog = { requestId, commitMsg, ts: Date.now(), edits: audit };
    await commitEdits(
      [
        {
          path: `requests/${requestId}.apply.log.json`,
          mode: "create",
          content: JSON.stringify(applyLog, null, 2),
        },
      ],
      `NDJC:${requestId} write apply log`
    );
    console.log("[NDJC] apply log written", { requestId });

    // 4) 写触发文件（push 触发工作流）
    await touchRequestFile(requestId, {
      appName: plan.appName,
      packageName: plan.packageName,
      filesChanged: plan.files.map((f) => f.path),
    });
    console.log("[NDJC] push trigger written", { requestId });

    // 5) 兜底：再发一个 repository_dispatch（即便 push 没触发，也能跑）
    try {
      await dispatchBuild("generate-apk", {
        requestId,
        appName: plan.appName,
        packageName: plan.packageName,
      });
      console.log("[NDJC] repository_dispatch sent", { requestId });
    } catch (e) {
      console.warn("[NDJC] repository_dispatch failed (ignored)", e);
    }

    console.log("[NDJC] done", { requestId, ms: Date.now() - startedAt });
    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    console.error("NDJC generate-app error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Groq or commit failed" },
      { status: 500 }
    );
  }
}
