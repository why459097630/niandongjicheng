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

    // 1) 生成编排计划（含补丁）
    const plan = await generatePlan({ prompt, appName, packageName, template });

    // 2) 组装要写入仓库的文件（请求、计划、补丁）
    const requestId = newId();
    const files: any[] = [
      {
        path: `requests/${requestId}.json`,
        mode: "create",
        content: JSON.stringify({ requestId, template, prompt, appName, packageName, ts: Date.now() }, null, 2),
      },
      {
        path: `requests/${requestId}.plan.json`,
        mode: "create",
        content: JSON.stringify(plan, null, 2),
      },
    ];

    // plan.files 里既可以是 patch，也可以是 content/contentBase64
    const edits = (plan.files || []) as any[];
    for (const f of edits) {
      if (f.mode === "patch") {
        files.push({ path: f.path, mode: "patch", patch: f.patch || "" });
      } else {
        // 新文件 / 覆盖文件
        files.push({
          path: f.path,
          mode: f.mode || "create",
          content: f.content ?? undefined,
          contentBase64: f.contentBase64 ?? undefined,
        });
      }
    }

    // 3) 提交到仓库（会看到一次 “NDJC: apply plan …” 的 commit）
    await commitEdits(files as any, `NDJC: apply plan for "${plan.appName}"`);

    // 4) 触发构建（保留你现在的 repository_dispatch 逻辑）
    const payload = {
      template,
      app_name: plan.appName,
      api_base: process.env.SITE_URL,      // 你的 vercel 站点
      api_secret: process.env.API_SECRET,  // 只要 workflow 需要就传
      owner: process.env.GH_OWNER,
      repo: process.env.GH_REPO,
      branch: process.env.GH_BRANCH || "main",
      version_name: "1.0.0",
      version_code: "1",
      reason: "api",
      request_id: requestId,               // 方便 workflow 生成 apply 日志
    };

    // 这里沿用你现有的 dispatch 代码（略），只要把 request_id 一并带上即可
    // await dispatchRepositoryEvent('generate-apk', payload);

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    console.error("NDJC generate-app error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
