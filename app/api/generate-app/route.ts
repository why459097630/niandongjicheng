// app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generatePlan } from "@/lib/ndjc/generator";
import { commitEdits, type FileEdit, touchRequestFile } from "@/lib/ndjc/github-writer";

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

    // —— 1) 先生成 requestId，用于后续所有留痕
    const requestId = newId();

    // —— 2) 调用 Groq（或你在 generator.ts 里实现的逻辑）生成“锚点补丁 JSON”
    const plan = await generatePlan({ prompt, appName, packageName });

    // —— 3) 组合一次提交：先写入 plan.json（留痕），再应用真实代码改动
    const edits: FileEdit[] = [
      {
        path: `requests/${requestId}.plan.json`,
        mode: "create",
        content: JSON.stringify(
          { requestId, ...plan, ts: Date.now() },
          null,
          2
        ),
      },
      ...(plan.files as any[]),
    ];

    // —— 4) 提交改动（返回 anchors 命中审计信息）
    const commitMsg = `NDJC:${requestId} apply plan for "${plan.appName}"`;
    const { audit } = await commitEdits(edits, commitMsg);

    // —— 5) 写入 apply 日志（每个文件的锚点是否命中）
    const applyLog = {
      requestId,
      commitMsg,
      ts: Date.now(),
      edits: audit,
    };
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

    // —— 6) 触发构建（最简 keep；你的工作流需监听 requests/**）
    await touchRequestFile(requestId, {
      appName: plan.appName,
      packageName: plan.packageName,
      filesChanged: plan.files.map((f) => f.path),
    });

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    // 打印到 Vercel Function Logs，便于排查
    console.error("NDJC generate-app error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Groq or commit failed" },
      { status: 500 }
    );
  }
}
