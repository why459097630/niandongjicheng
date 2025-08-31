import { NextResponse } from "next/server";
import { generateWithAudit, commitAndBuild } from "@/lib/ndjc/generator";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const gen = await generateWithAudit({
    prompt: body.prompt ?? "",
    template: body.template ?? "core-template",
    anchors: body.anchors ?? [],
    raw: body,
  });

  const dispatchInput = {
    files: body.files ?? [],
    message: `NDJC: ${process.env.NDJC_APP_NAME ?? "generated"} commit`,
    ref: process.env.GH_BRANCH ?? "main",
    workflowFile: process.env.WORKFLOW_ID, // 关键
  };

  let dispatch: any; let error: any = null;
  try { dispatch = await commitAndBuild(dispatchInput); }
  catch (e: any) { error = { message: e?.message ?? String(e) }; }

  return NextResponse.json({
    ok: !error && !!dispatch?.ok,
    env: {
      hasOwner: !!process.env.GH_OWNER,
      hasRepo: !!process.env.GH_REPO,
      hasToken: !!process.env.GH_TOKEN,      // 若这里是 false → 没拿到 PAT
      hasWorkflow: !!process.env.WORKFLOW_ID // 若这里是 false → 没配置工作流标识
    },
    dispatch,   // { ok, writtenCount, note }
    error,      // { message: "...404/403..." }
    generated: { buildId: gen.buildId, requestDir: gen.requestDir }
  });
}
