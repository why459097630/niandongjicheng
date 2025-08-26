import { NextRequest, NextResponse } from "next/server";
import { callGroqToSpec } from "@/lib/ndjc/groq-client";
import { planFromSpec } from "@/lib/ndjc/generator";
import { commitEdits, touchRequestFile } from "@/lib/ndjc/github-writer";

export async function POST(req: NextRequest) {
  try {
    const { prompt, appName, packageName } = await req.json();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
    }

    // 1) 调 GROQ → 得到 JSON Spec
    const spec = await callGroqToSpec({
      prompt,
      appName: appName || "NDJC App",
      packageName: packageName || "com.example.app",
    });

    // 2) 转成差量补丁 Plan
    const plan = planFromSpec(spec);
    if (!plan.files.length) {
      throw new Error("NDJC: spec produced no edits (空包保护)");
    }

    // 3) 写入仓库（commit）
    const requestId = Date.now().toString();
    await commitEdits(
      [
        { path: `requests/${requestId}.plan.json`, mode: "create", content: JSON.stringify(plan, null, 2) },
        ...plan.files,
      ],
      `NDJC: apply plan for "${plan.appName}"`
    );

    // 记录 apply log
    await touchRequestFile(requestId, { from: "generate-app" });

    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    console.error("NDJC generate-app error:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
