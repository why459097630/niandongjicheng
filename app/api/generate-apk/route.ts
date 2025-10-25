// app/api/generate-apk/route.ts
// 云端瘦路由：调用两阶段 orchestrator，直接把结果回给前端。
// - 不再做老的 contract-precheck/validateContractV1
// - 不push GitHub，不dispatch workflow
// - Vercel 环境下不落盘，构建日志只走返回体里的 debug/usage

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/ndjc/orchestrator";

/* ---------------- CORS ---------------- */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/* -------------- runId -------------- */
function newRunId() {
  const api: Crypto | undefined = (globalThis as any).crypto;
  if (api?.getRandomValues) {
    const r = api.getRandomValues(new Uint8Array(6));
    const hex = Array.from(r).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}-${hex}`;
  }
  const rand = Math.random().toString(16).slice(2, 8);
  return `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}-${rand}`;
}

/* ---------------- 路由主逻辑 ---------------- */
export async function POST(req: NextRequest) {
  let step = "start";
  const runId = newRunId();

  try {
    step = "parse-input";
    const input = await req.json().catch(() => ({} as any));

    // 统一整理一下传给 orchestrator 的字段
    // - requirement: 用户自然语言需求
    // - template_key: 模板 (比如 circle-basic)
    // - runId: 我们生成的 runId
    // - mode: A / B (UI里你传的 "A")
    const requirement =
      (input.requirement ??
        input.nl ??
        input.prompt ??
        "") as string;

    const templateKey =
      (input.template_key ??
        input.template ??
        "circle-basic") as string;

    const mode =
      (input.mode ??
        "A") as string;

    step = "orchestrate-two-phase";

    // orchestrate() 现在就是两阶段 orchestrator：
    // 返回形如：
    // {
    //   ok: boolean,
    //   runId: string,
    //   plan: any | null,
    //   phase1Spec: any,
    //   violations: string[],
    //   usage: {...},
    //   debug: { phase1Raw, phase1Clean, phase2Raw }
    // }
    //
    // 注意：我们强制传 provider/model 等是可选的，这里只做最小必需输入。
    const orches = await orchestrate({
      requirement,
      template_key: templateKey,
      runId,
      mode,
    } as any);

    // 如果 phase2 校验没通过（plan=null），我们走 422，把 violations 返回给前端 UI。
    if (!orches.ok || !orches.plan) {
      return NextResponse.json(
        {
          ok: false,
          runId: orches.runId ?? runId,
          step: "phase2-validate",
          violations: orches.violations ?? [],
          usage: orches.usage ?? null,
          debug: orches.debug ?? null,
        },
        { status: 422, headers: CORS }
      );
    }

    // 如果成功（plan 存在），我们直接把最终契约 contract 返回给前端。
    // contract = orches.plan
    // usage = token 统计
    // debug = LLM的 phase1/phase2 原文快照，前端可以当“构建日志”展示
    return NextResponse.json(
      {
        ok: true,
        runId: orches.runId ?? runId,
        step: "done",
        contract: orches.plan,
        phase1Spec: orches.phase1Spec ?? null,
        usage: orches.usage ?? null,
        debug: orches.debug ?? null,
      },
      { status: 200, headers: CORS }
    );
  } catch (e: any) {
    // 真正代码异常 -> 500
    return NextResponse.json(
      {
        ok: false,
        runId,
        step,
        error: String(e?.message ?? e),
      },
      { status: 500, headers: CORS }
    );
  }
}
