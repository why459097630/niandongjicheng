// app/api/generate-apk/route.ts
// 最小改动 + GitHub Actions 触发版
// - 兼容提取 orchestrator 原文；空文本不进严格校验
// - 成功后触发 GitHub Actions（workflow_dispatch 为默认；可切换 repository_dispatch）
// - 返回 dispatched 状态与关键调试字段，避免“已触发但没有 run”的假阳性

import { NextRequest, NextResponse } from "next/server";

import { orchestrate } from "@/lib/ndjc/orchestrator";
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";

// 如果你已有真正的 sanitize 模块，可替换为实际导入；这里给一个安全占位实现，避免构建期找不到模块。
function sanitizePlan<T = any>(plan: T): T {
  return plan;
}

export const runtime = "nodejs"; // orchestrator 用 fs 读取 .txt，必须 Node 运行时

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

/* ---------------- GitHub Actions 触发辅助 ---------------- */

// 从环境里拿一个可用的 PAT（优先顺序可按需调整）
function getGhToken(): string | null {
  return (
    process.env.NDJC_GITHUB_PAT ||
    process.env.GITHUB_PAT ||
    process.env.GH_PAT ||
    process.env.GITHUB_TOKEN || // 注意：这个通常仅对同仓库有效，跨仓库需 PAT
    null
  );
}

// workflow_dispatch 触发
async function dispatchWorkflow(params: {
  owner: string;
  repo: string;
  workflow: string; // e.g. "android-build.yml"
  ref: string; // e.g. "main"
  inputs?: Record<string, any>;
  token: string;
}) {
  const { owner, repo, workflow, ref, inputs = {}, token } = params;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref, inputs }),
  });
  const text = await resp.text();
  return {
    url,
    status: resp.status,
    text: text?.slice(0, 500) || "",
    // NOTE: 204 表示成功触发
    ok: resp.status === 204,
  };
}

// repository_dispatch 触发（可选）
async function dispatchRepository(params: {
  owner: string;
  repo: string;
  eventType: string; // e.g. "ndjc-build"
  clientPayload?: Record<string, any>;
  token: string;
}) {
  const { owner, repo, eventType, clientPayload = {}, token } = params;
  const url = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
  });
  const text = await resp.text();
  return {
    url,
    status: resp.status,
    text: text?.slice(0, 500) || "",
    ok: resp.status === 204,
  };
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

    // 1) 编排（orchestrate 会在在线失败时兜底，trace 内含 raw 线索）
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

    // 5) Contract → Plan → Sanitize（Sanitize 这里用安全占位；如有真实实现可替换）
    const plan = contractV1ToPlan(validated);
    const planSanitized = sanitizePlan(plan);

    /* ---------------- 6) 触发 GitHub Actions（新增） ---------------- */
    // 环境变量约定（你可以在 Vercel 上配置）：
    // NDJC_GH_OWNER：目标仓库 owner
    // NDJC_GH_REPO： 目标仓库 repo
    // NDJC_GH_WORKFLOW：workflow 文件名（例如 android-build.yml）
    // NDJC_GH_REF：   触发分支（默认 main）
    // NDJC_GH_MODE：  "workflow"（默认）或 "repo"（repository_dispatch）
    // NDJC_GITHUB_PAT / GITHUB_PAT / GH_PAT / GITHUB_TOKEN：鉴权 Token（优先 PAT）
    const GH_OWNER = process.env.NDJC_GH_OWNER || "";
    const GH_REPO = process.env.NDJC_GH_REPO || "";
    const GH_WORKFLOW = process.env.NDJC_GH_WORKFLOW || "android-build.yml";
    const GH_REF = process.env.NDJC_GH_REF || "main";
    const GH_MODE = (process.env.NDJC_GH_MODE || "workflow").toLowerCase(); // "workflow" | "repo"
    const GH_TOKEN = getGhToken();

    let dispatched = false;
    let ghInfo:
      | { url: string; status: number; text: string; ok: boolean }
      | { skipped: true; reason: string }
      | null = null;

    if (GH_OWNER && GH_REPO && GH_TOKEN) {
      if (GH_MODE === "repo") {
        // repository_dispatch 触发
        ghInfo = await dispatchRepository({
          owner: GH_OWNER,
          repo: GH_REPO,
          eventType: "ndjc-build",
          clientPayload: { run_id: runId, template_key, mode },
          token: GH_TOKEN,
        });
        dispatched = !!ghInfo.ok;
      } else {
        // 默认：workflow_dispatch 触发
        ghInfo = await dispatchWorkflow({
          owner: GH_OWNER,
          repo: GH_REPO,
          workflow: GH_WORKFLOW,
          ref: GH_REF,
          inputs: { run_id: runId, template_key, mode },
          token: GH_TOKEN,
        });
        dispatched = !!ghInfo.ok;
      }
    } else {
      ghInfo = {
        skipped: true,
        reason:
          "Missing NDJC_GH_OWNER/NDJC_GH_REPO or GitHub token (NDJC_GITHUB_PAT/GITHUB_PAT/GH_PAT/GITHUB_TOKEN).",
      };
    }

    // 7) 成功返回（含最关键的 trace 与触发结果，便于前端/日志定位）
    return NextResponse.json(
      {
        ok: true,
        runId,
        contract: "v1",
        meta: { _trace: orch.trace },
        contract_raw_len: raw.length,
        plan: planSanitized,
        // NOTE: 前端只有在 dispatched === true 时显示“已触发”
        dispatched,
        gh: ghInfo,
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
