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

    // 1) 生成计划（GROQ 优先，失败回退本地）
    let plan: any;
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

    // 2) 统一把 NdjcPatch 转成 writer 需要的结构
    //    - create/replace: content 或 contentBase64
    //    - patch:  writer 期望是 patches: []，我们将单条 patch 兜底包成 [{ patch }]
    const rawEdits = plan.files.map((f: any) => {
      // 规范化 mode
      const mode = f.mode === "replace" ? "replace" : f.mode === "patch" ? "patch" : "create";

      if (mode === "patch") {
        // 兼容两种来源：f.patches（数组）或 f.patch（字符串）
        const patches =
          Array.isArray(f.patches) && f.patches.length > 0
            ? f.patches
            : [{ patch: f.patch ?? "" }];

        return {
          path: f.path,
          mode: "patch",
          patches, // ✅ 适配 github-writer 期待的 patches 字段
        };
      }

      // create/replace：contentBase64 优先；否则用 content（字符串）
      if (f.contentBase64) {
        return {
          path: f.path,
          mode, // "create" | "replace"
          contentBase64: f.contentBase64,
        };
      }
      return {
        path: f.path,
        mode, // "create" | "replace"
        content: f.content ?? "",
      };
    });

    // 关键：这里整体 cast 成 FileEdit[]，避免 TS 对 writer 的严格泛型不兼容
    const edits = rawEdits as unknown as FileEdit[];

    const requestId = `${Date.now()}`;

    // 3) 顺手把 plan 落库，便于追踪与回放
    await commitEdits(
      [
        {
          path: `requests/${requestId}.plan.json`,
          mode: "create",
          content: JSON.stringify(plan, null, 2),
        },
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
