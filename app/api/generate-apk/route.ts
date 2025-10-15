// app/api/generate-apk/route.ts
// 作用：瘦路由：CORS → 调 orchestrate → 只在拿到非空原文时再做 parse/validate → 后续落盘/触发CI。
// 关键修正：
// 1) 预检阶段兼容读取 trace.raw_llm_text / trace.retry_raw_llm_text；若仍无，则兜底用 result.raw。
// 2) raw 为空时不再送入严格校验，直接 400 + 透传 trace，避免 "E_NOT_JSON"。
// 3) 其余流水线顺序不变（parse → validate → contractV1ToPlan → sanitize 等留你现有实现）。

import { NextRequest, NextResponse } from "next/server";

import { orchestrate } from "@/lib/ndjc/orchestrator";
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";
// 若你有 sanitize / linter / materialize 等步骤，这里照旧引入（保持原有流水线）
import { sanitizePlan } from "@/lib/ndjc/sanitize"; // 如果你的实现不同，请替换/移除
// import { runPlanLinter } from "@/lib/ndjc/guard/plan_linter"; // 可选

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

/** 统一从 trace/result 里提取原始 LLM 文本 */
function extractRawFromTrace(orchestrateResult: any): string {
  const t = orchestrateResult?.trace || {};
  // NOTE: 兼容编排器 trace 字段（这是这次修复的关键）
  const candidates = [
    t.raw_llm_text,
    t.retry_raw_llm_text,
    orchestrateResult?.raw, // 兜底：编排器直接返回的 raw 字段
  ].filter(Boolean);
  const raw = (candidates[0] || "").toString();
  return raw;
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

    // 1) 调 orchestrator（它会在在线失败时自动离线回退，保证 raw 尽量非空）
    const orch = await orchestrate({ runId, nl, preset_hint, template_key, mode, allowCompanions });

    // 2) 失败分支（编排器离线也失败时）
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

    // 3) 预检：从 trace / result 提取原始文本；为空则不做严格校验，直接 400 + 透传 trace
    const raw = extractRawFromTrace(orch);
    if (!raw?.trim()) {
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

    // 4) 严格解析 + 验证
    const parsed = parseStrictJson(raw);
    const validated = validateContractV1(parsed);

    // 5) Contract → Plan → Sanitize（保持你原有流水线；如无 sanitize，可直接跳过）
    const plan = contractV1ToPlan(validated);
    const planSanitized = typeof sanitizePlan === "function" ? sanitizePlan(plan) : plan;

    // TODO：如需：写入 01/02/03 到 Packaging-warehouse、触发 CI、记录 logs 等，沿用你现有逻辑即可。
    // 这里不更动你的落盘/触发方式，避免影响流水线其它环节。

    // 6) 成功返回（含最关键的 trace）
    return NextResponse.json(
      {
        ok: true,
        runId,
        contract: "v1",
        meta: { _trace: orch.trace },
        contract_raw_len: raw.length,
        contract_preview: raw.slice(0, 1600), // 便于前端/日志快速查看（按需可移除）
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
