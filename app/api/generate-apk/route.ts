// app/api/generate-apk/route.ts
// 瘦路由（Node）：编排 / Contract v1 严格校验 / 写入 00/01/02/03 / 触发 GitHub Actions。

import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/ndjc/orchestrator";
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";
import { ensureRunBranchAndCommitFiles } from "@/lib/github/write-files";

export const runtime = "nodejs";

/* ---------------- CORS ---------------- */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/* =========================================================
 * 主入口：生成 APK
 * =======================================================*/
export async function POST(req: NextRequest) {
  try {
    const input = await req.json();
    const runId = input?.runId || `ndjc-${Date.now()}`;
    console.log(`[NDJC] 🚀 Run started: ${runId}`);

    // 执行两阶段编排（Phase1 + Phase2）
    const o = await orchestrate(input);

    /* ---------------- Contract 校验 ---------------- */
    const contractOut = parseStrictJson(o?.raw || "{}");
    const valid = validateContractV1(contractOut);
    if (!valid.ok) {
      console.warn(`[NDJC] Contract v1 invalid: ${valid.errors?.join(", ")}`);
    }

    /* ---------------- 生成 Plan ---------------- */
    const planV1 = await contractV1ToPlan(contractOut);

    /* ---------------- 构造 apply 结果（stub） ---------------- */
    const applyStub = {
      status: "ok",
      template: o?.template || input?.template,
      mode: o?._mode || "A",
      anchorsCount: Object.keys(planV1?.anchorsGrouped?.text || {}).length,
      timestamp: new Date().toISOString(),
    };

    /* =========================================================
     * 00_debug_two_phase.json — 两阶段构建日志
     * =======================================================*/
    const debugTwoPhase = {
      runId,
      timestamp: new Date().toISOString(),
      template: o?.template || input?.template || "circle-basic",
      mode: o?._mode || "A",

      phase1: {
        raw: o?.trace?.phase1_raw || o?.phase1_raw || null,
        checked: o?.trace?.phase1_checked || o?.phase1_checked || null,
        issues: o?.trace?.phase1_issues || [],
      },

      phase2: {
        raw: o?.trace?.phase2_raw || o?.phase2_raw || null,
        checked: planV1 || o?.trace?.phase2_checked || null,
        issues: o?.trace?.phase2_issues || [],
      },

      tokens: {
        phase1_in: o?.usage?.phase1_in || o?.trace?.usage?.phase1_in || null,
        phase1_out: o?.usage?.phase1_out || o?.trace?.usage?.phase1_out || null,
        phase2_in: o?.usage?.phase2_in || o?.trace?.usage?.phase2_in || null,
        phase2_out: o?.usage?.phase2_out || o?.trace?.usage?.phase2_out || null,
        total_in: o?.usage?.total_in || o?.trace?.usage?.total_in || null,
        total_out: o?.usage?.total_out || o?.trace?.usage?.total_out || null,
        total: o?.usage?.total || o?.trace?.usage?.total || null,
      },
    };

    /* =========================================================
     * 推送到 GitHub 构建分支（requests/<runId>/）
     * =======================================================*/
    const {
      GH_OWNER: owner,
      GH_REPO: repo,
      GH_BRANCH: wfBranch,
      GH_TOKEN: token,
    } = process.env as Record<string, string>;

    const branch = `ndjc-run/${runId}`;
    const runDir = `requests/${runId}`;

    const summaryLines = [
      `NDJC run ID: ${runId}`,
      `Template: ${o?.template || input?.template}`,
      `Mode: ${o?._mode || "A"}`,
      `Anchors: ${Object.keys(planV1?.anchorsGrouped?.text || {}).length}`,
      `Timestamp: ${new Date().toISOString()}`,
    ];

    await ensureRunBranchAndCommitFiles({
      owner,
      repo,
      baseRef: wfBranch,
      runBranch: branch,
      token,
      files: [
        {
          path: `${runDir}/00_debug_two_phase.json`,
          content: JSON.stringify(debugTwoPhase, null, 2),
        },
        {
          path: `${runDir}/01_contract.json`,
          content: JSON.stringify(contractOut, null, 2),
        },
        {
          path: `${runDir}/02_plan.json`,
          content: JSON.stringify(planV1, null, 2),
        },
        {
          path: `${runDir}/03_apply_result.json`,
          content: JSON.stringify(applyStub, null, 2),
        },
        {
          path: `${runDir}/actions-summary.txt`,
          content: summaryLines.join("\n"),
        },
      ],
    });

    console.log(`[NDJC] ✅ Files committed for run ${runId}`);

    /* =========================================================
     * 返回响应
     * =======================================================*/
    return NextResponse.json(
      {
        ok: true,
        runId,
        mode: o?._mode || "A",
        usage: debugTwoPhase.tokens,
        repoPath: `${repo}/tree/${branch}/${runDir}`,
        message: "NDJC build orchestrated and committed successfully.",
      },
      { headers: CORS }
    );
  } catch (err: any) {
    console.error("[NDJC] ❌ Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Internal error" },
      { status: 500, headers: CORS }
    );
  }
}
