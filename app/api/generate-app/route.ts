// app/api/generate-app/route.ts
import { NextRequest, NextResponse } from "next/server";
import { callGroqToSpec } from "@/lib/ndjc/groq-client";
import { planFromSpec, generatePlan } from "@/lib/ndjc/generator";
import { commitEdits, type FileEdit, touchRequestFile } from "@/lib/ndjc/github-writer";

export async function POST(req: NextRequest) {
  try {
    const { prompt, appName, packageName } = await req.json();
    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
    }

    const base = {
      appName: (appName || "NDJC App").trim(),
      packageName: (packageName || "com.example.app").trim(),
    };

    let plan;
    try {
      const spec = await callGroqToSpec({ prompt, ...base });
      plan = planFromSpec(spec);
    } catch (err) {
      console.error("GROQ failed, fallback to local generator:", err);
      plan = await generatePlan({ prompt, ...base });
    }

    if (!plan?.files?.length) {
      throw new Error("NDJC: no edits produced (空包保护)");
    }

    // ✅ 关键：把 NdjcPatch[] 转成 FileEdit[]
    const edits: FileEdit[] = plan.files.map((f: any) => {
      if (f.mode === "patch") {
        // 差量补丁
        return { path: f.path, mode: "patch", patch: f.patch || "" };
      } else {
        // 新建/替换文件
        if (f.contentBase64) {
          return { path: f.path, mode: f.mode === "replace" ? "replace" : "create", contentBase64: f.contentBase64 };
        }
        return { path: f.path, mode: f.mode === "replace" ? "replace" : "create", content: f.content ?? "" };
      }
    });

    const requestId = `${Date.now()}`;

    await commitEdits(
      [
        // 方便排查：把计划也存一份
        { path: `requests/${requestId}.plan.json`, mode: "create", content: JSON.stringify(plan, null, 2) },
        ...edits,
      ],
      `NDJC: apply plan for "${plan.appName}"`
    );

    await touchRequestFile(requestId, { from: "generate-app" });
    return NextResponse.json({ ok: true, requestId });
  } catch (e: any) {
    console.error("NDJC generate-app error:", e);
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
