// app/api/generate-apk/route.ts
// 最小改动修正版：兼容读取 orchestrator 原文；空文本不进严格校验，直接 400 + 透传 trace

import { NextRequest, NextResponse } from "next/server";

import { orchestrate } from "@/lib/ndjc/orchestrator";
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";

// 若你已有真正的 sanitize 模块，可替换为实际导入；这里给一个安全的占位实现，避免构建期找不到模块。
function sanitizePlan<T = any>(plan: T): T {
  return plan;
}

export const runtime = "nodejs";

/* ---------------- CORS ---------------- */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS });
}

/** 从 orchestrator 结果里提取“原始 LLM 文本” */
function extractRaw(orchestrateResult: any): string {
  const t = orchestrateResult?.trace || {};
  const candidates = [
    orchestrateResult?.raw,           // ✅ 新版编排器直接返回的 raw
    t?.raw_llm_text,                  // ✅ 首次 LLM 返回记录在 trace
    t?.retry_raw_llm_text,            // ✅ 重试 LLM 返回记录在 trace
  ];
  const picked = candidates.find((x) => typeof x === "string" && x.trim().length > 0);
  return picked ?? "";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      run_id: runId,
      nl = "",
      preset_hint = "",
      template_key = "circle-basic",
      mode = "B",
      allowCompanions = true,
    } = body || {};

    if (!runId || !nl) {
      return NextResponse.json(
        { error: "Missing required fields: run_id, nl" },
        { status: 400, headers: CORS }
      );
    }

    // 1) 编排（orchestrate 保证：在线失败会尽量兜底，trace 内含 raw 线索）
    const orch = await orchestrate({ runId, nl, preset_hint, template_key, mode, allowCompanions });

    // 2) 编排失败（离线也失败）——直接透传错误与 trace
    if (!orch.ok) {
      return NextResponse.json(
        {
          contract: "v1",
          runId,
          step: "contract-precheck",
          reason: orch.reason,
          meta: { _trace: orch.trace },
        },
        { status: 400, headers: CORS }
      );
    }

    // 3) 预检：从 result / trace 里提取“原文”；取不到就直接 400（不进严格校验）
    const raw = extractRaw(orch);
    if (!raw.trim()) {
      return NextResponse.json(
        {
          contract: "v1",
          runId,
          step: "contract-precheck",
          reason: [{ code: "E_NOT_JSON", message: "No raw LLM text to validate", path: "<root>" }],
          meta: { _trace: orch.trace },
        },
        { status: 400, headers: CORS }
      );
    }

    // 4) 严格解析 + 验证（保持原有顺序与逻辑）
    const parsed = parseStrictJson(raw);
    const validated = validateContractV1(parsed);

    // 5) Contract → Plan → Sanitize（Sanitize 为安全占位实现；你可替换为真实 sanitize）
    const plan = contractV1ToPlan(validated);
    const planSanitized = sanitizePlan(plan);

    // TODO: 若你有落盘 01/02/03、触发 CI 的逻辑，保持你现有实现；此处不作变更

    // 6) 成功返回（携带 trace，便于前端或日志定位）
    return NextResponse.json(
      {
        ok: true,
        runId,
        contract: "v1",
        meta: { _trace: orch.trace },
        contract_raw_len: raw.length,
        contract_preview: raw.slice(0, 1200), // 便于快速查看，可按需移除
        plan: planSanitized,
      },
      { status: 200, headers: CORS }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        step: "route-catch",
        error: String(e?.message || e),
      },
      { status: 500, headers: CORS }
    );
  }
}
