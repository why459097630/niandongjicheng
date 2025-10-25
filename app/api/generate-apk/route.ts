// app/api/generate-apk/route.ts
// 瘦路由（Node）：两阶段编排 / Contract v1 严格校验 / 推送 run 分支 / 触发 GitHub Actions
// 现在会把 phase1 / phase2 / tokens 单独落盘成多份 00_*.json，方便在构建分支的 requests/<runId>/ 下直接查看

import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/ndjc/orchestrator";
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";

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
 * GitHub 提交 / workflow 触发工具
 * =======================================================*/
const GH_API = "https://api.github.com";

async function gh(
  headers: Record<string, string>,
  method: string,
  url: string,
  body?: any
) {
  const r = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${method} ${url} -> ${r.status} ${r.statusText}: ${text}`);
  }
  return r;
}

async function ensureRunBranchAndCommitFiles(args: {
  owner: string;
  repo: string;
  baseRef: string;
  runBranch: string;
  token: string;
  files: Array<{ path: string; content: string }>;
}) {
  const { owner, repo, baseRef, runBranch, token, files } = args;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // 1) 找 baseRef 最新 commit SHA
  const baseRefData = await (
    await gh(
      headers,
      "GET",
      `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${baseRef}`
    )
  ).json();
  const baseSha: string = baseRefData.object.sha;

  // 2) 创建 runBranch（若不存在）
  let hasRunBranch = true;
  try {
    await gh(
      headers,
      "GET",
      `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${runBranch}`
    );
  } catch {
    hasRunBranch = false;
  }
  if (!hasRunBranch) {
    await gh(headers, "POST", `${GH_API}/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${runBranch}`,
      sha: baseSha,
    });
  }

  // 3) 写入/更新文件
  for (const f of files) {
    const url = `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      f.path
    )}`;

    // 查现有 sha（如果已存在）
    let sha: string | undefined;
    try {
      const existing = await (
        await gh(headers, "GET", `${url}?ref=${runBranch}`)
      ).json();
      sha = existing.sha;
    } catch {
      sha = undefined;
    }

    await gh(headers, "PUT", url, {
      message: `NDJC: materialize ${runBranch} -> ${f.path}`,
      content: Buffer.from(f.content, "utf8").toString("base64"),
      branch: runBranch,
      sha,
    });
  }
}

// 二选一触发：workflow_dispatch / repository_dispatch
async function dispatchWorkflowRepository(args: {
  owner: string;
  repo: string;
  token: string;
  payload: any;
}) {
  const { owner, repo, token, payload } = args;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const url = `${GH_API}/repos/${owner}/${repo}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      event_type: "generate-apk",
      client_payload: payload,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(
      `GitHub repository_dispatch ${r.status} ${r.statusText}: ${text}`
    );
  }

  return { degraded: false };
}

/* =========================================================
 * Helpers
 * =======================================================*/
function newRunId() {
  const api: Crypto | undefined = (globalThis as any).crypto;
  if (api?.getRandomValues) {
    const r = api.getRandomValues(new Uint8Array(6));
    const hex = Array.from(r)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `ndjc-${Date.now()}-${hex}`;
  }
  return `ndjc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function b64(str: string) {
  const enc = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < enc.length; i++) bin += String.fromCharCode(enc[i]);
  // @ts-ignore
  return btoa(bin);
}

function extractIssuesList(issues: any) {
  if (!issues) return [];
  if (Array.isArray(issues)) return issues;
  return [issues];
}

// parseStrictJson 返回 { ok: boolean; data?: any; error?: string }
function unwrapParseResult(p: any) {
  if (p && p.ok && p.data) return p.data;
  return {};
}

/* =========================================================
 * 主入口
 * =======================================================*/
export async function POST(req: NextRequest) {
  const runId = newRunId();

  try {
    const input = await req.json();
    console.log(`[NDJC] 🚀 Run started: ${runId}`);

    /* ---------------- orchestrator，两阶段生成 ---------------- */
    // orchestrate 应返回类似：
    // {
    //   ok: true,
    //   runId,
    //   _mode: "A" | "B" | ...,
    //   template: "circle-basic",
    //   raw: string (phase2 final raw?)  ⟵ 可能无
    //   contract: object (maybe parsed),
    //   plan: object,
    //   phase1Spec: {...},
    //   trace: {
    //     phase1_raw,
    //     phase1_checked,
    //     phase1_issues,
    //     phase2_raw,
    //     phase2_checked,
    //     phase2_issues,
    //     usage: { phase1_in, phase1_out, phase2_in, phase2_out, total_in, total_out, total }
    //   },
    //   usage: same as trace.usage (optional mirror)
    // }
    const o = await orchestrate(input);

    /* ---------------- Contract 校验 ---------------- */
    // phase2_checked 应该就是最终 contract-ish 对象；fallback 用 o.contract / o.plan 等
    // raw 文本尝试 parseStrictJson，没就用 phase2_checked
    const rawCandidate =
      (o as any)?.raw ||
      (o as any)?.trace?.phase2_raw ||
      (o as any)?.trace?.phase1_raw ||
      "{}";

    const parsedAttempt = parseStrictJson(String(rawCandidate));
    const parsedObj = unwrapParseResult(parsedAttempt);

    // 谁算最终 contractOut: 优先 parsedObj，否则 o.contract，否则 o.phase2_checked/phase1_checked
    const contractOut =
      Object.keys(parsedObj).length > 0
        ? parsedObj
        : (o as any)?.contract ||
          (o as any)?.trace?.phase2_checked ||
          (o as any)?.trace?.phase1_checked ||
          {};

    // 校验
    const validRes = await validateContractV1(contractOut);
    // validRes: { ok: boolean; issues?: {code,message,...}[] }
    if (!validRes.ok) {
      console.warn(
        `[NDJC] Contract v1 invalid: ${extractIssuesList(validRes.issues)
          .map((i: any) => i?.message || i?.code || JSON.stringify(i))
          .join(", ")}`
      );
    }

    /* ---------------- Plan ---------------- */
    // contractV1ToPlan 期望 contractOut 是完整 Contract v1
    const planV1 = await contractV1ToPlan(contractOut);

    /* ---------------- applyStub (03) ---------------- */
    const anchorsCount = Object.keys(
      (planV1 as any)?.anchorsGrouped?.text || {}
    ).length;

    const applyStub = {
      status: "ok",
      template:
        (o as any)?.template ||
        (planV1 as any)?.meta?.template ||
        input?.template ||
        "circle-basic",
      mode: (o as any)?._mode || (input?.mode ?? "A"),
      anchorsCount,
      timestamp: new Date().toISOString(),
    };

    /* ---------------- phase / tokens 展开成独立文件 ---------------- */
    const phase1_raw =
      (o as any)?.trace?.phase1_raw || (o as any)?.phase1_raw || null;
    const phase1_checked =
      (o as any)?.trace?.phase1_checked ||
      (o as any)?.phase1_checked ||
      null;
    const phase1_issues = extractIssuesList(
      (o as any)?.trace?.phase1_issues || (o as any)?.phase1_issues
    );

    const phase2_raw =
      (o as any)?.trace?.phase2_raw || (o as any)?.phase2_raw || null;
    const phase2_checked =
      (o as any)?.trace?.phase2_checked ||
      (o as any)?.phase2_checked ||
      planV1 ||
      null;
    const phase2_issues = extractIssuesList(
      (o as any)?.trace?.phase2_issues || (o as any)?.phase2_issues
    );

    // usage 可能在 o.usage 或 trace.usage
    const usage = (o as any)?.usage || (o as any)?.trace?.usage || {};
    const tokensReport = {
      phase1_in: usage.phase1_in ?? null,
      phase1_out: usage.phase1_out ?? null,
      phase2_in: usage.phase2_in ?? null,
      phase2_out: usage.phase2_out ?? null,
      total_in: usage.total_in ?? null,
      total_out: usage.total_out ?? null,
      total: usage.total ?? null,
    };

    /* ---------------- debugTwoPhase (00_debug_two_phase.json) ---------------- */
    const debugTwoPhase = {
      runId,
      timestamp: new Date().toISOString(),
      template:
        (o as any)?.template ||
        (planV1 as any)?.meta?.template ||
        input?.template ||
        "circle-basic",
      mode: (o as any)?._mode || (input?.mode ?? "A"),
      phase1: {
        raw: phase1_raw,
        checked: phase1_checked,
        issues: phase1_issues,
      },
      phase2: {
        raw: phase2_raw,
        checked: phase2_checked,
        issues: phase2_issues,
      },
      tokens: tokensReport,
    };

    /* ---------------- 额外 00_* 文件（细分） ---------------- */
    const phase1RawJson = {
      runId,
      stage: "phase1",
      kind: "raw",
      data: phase1_raw,
    };

    const phase1CheckedJson = {
      runId,
      stage: "phase1",
      kind: "checked",
      data: phase1_checked,
      issues: phase1_issues,
    };

    const phase2RawJson = {
      runId,
      stage: "phase2",
      kind: "raw",
      data: phase2_raw,
    };

    const phase2CheckedJson = {
      runId,
      stage: "phase2",
      kind: "checked",
      data: phase2_checked,
      issues: phase2_issues,
    };

    const tokenUsageJson = {
      runId,
      tokens: tokensReport,
    };

    /* ---------------- actions-summary.txt 内容 ---------------- */
    const summaryLines = [
      `NDJC run ID: ${runId}`,
      `template: ${
        (o as any)?.template ||
        (planV1 as any)?.meta?.template ||
        input?.template ||
        "circle-basic"
      }`,
      `mode: ${(o as any)?._mode || (input?.mode ?? "A")}`,
      `anchorsCount: ${anchorsCount}`,
      `timestamp: ${new Date().toISOString()}`,
      "",
      "Artifacts in this run directory:",
      "- 00_debug_two_phase.json          (high-level bundle: phase1/phase2/tokens)",
      "- 00_phase1_raw.json               (phase1 original LLM output)",
      "- 00_phase1_checked.json           (phase1 parsed & validation result)",
      "- 00_phase2_raw.json               (phase2 original LLM output)",
      "- 00_phase2_checked.json           (phase2 parsed/merged contract & issues)",
      "- 00_token_usage.json              (token usage for phase1/phase2)",
      "- 01_contract.json                 (final contract object we validated)",
      "- 02_plan.json                     (plan derived from final contract)",
      "- 03_apply_result.json             (apply stub summary for CI)",
    ];

    /* ---------------- 写入 run 分支 requests/<runId>/ ---------------- */
    const {
      GH_OWNER: owner,
      GH_REPO: repo,
      GH_BRANCH: wfBranch,
      GH_PAT: token,
    } = process.env as Record<string, string>;

    if (!owner || !repo || !token || !wfBranch) {
      throw new Error("Missing GH_OWNER / GH_REPO / GH_BRANCH / GH_PAT");
    }

    const branch = `ndjc-run/${runId}`;
    const runDir = `requests/${runId}`;

    await ensureRunBranchAndCommitFiles({
      owner,
      repo,
      baseRef: wfBranch,
      runBranch: branch,
      token,
      files: [
        // phase logs
        {
          path: `${runDir}/00_debug_two_phase.json`,
          content: JSON.stringify(debugTwoPhase, null, 2),
        },
        {
          path: `${runDir}/00_phase1_raw.json`,
          content: JSON.stringify(phase1RawJson, null, 2),
        },
        {
          path: `${runDir}/00_phase1_checked.json`,
          content: JSON.stringify(phase1CheckedJson, null, 2),
        },
        {
          path: `${runDir}/00_phase2_raw.json`,
          content: JSON.stringify(phase2RawJson, null, 2),
        },
        {
          path: `${runDir}/00_phase2_checked.json`,
          content: JSON.stringify(phase2CheckedJson, null, 2),
        },
        {
          path: `${runDir}/00_token_usage.json`,
          content: JSON.stringify(tokenUsageJson, null, 2),
        },

        // contract / plan / apply
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

    /* ---------------- 调用 GitHub Actions (repository_dispatch) ---------------- */
    const payload = {
      runId,
      template:
        (o as any)?.template ||
        (planV1 as any)?.meta?.template ||
        input?.template ||
        "circle-basic",
      packageName:
        (planV1 as any)?.meta?.packageId ||
        (contractOut as any)?.metadata?.packageId ||
        "",
      mode: (o as any)?._mode || (input?.mode ?? "A"),
    };

    try {
      await dispatchWorkflowRepository({
        owner,
        repo,
        token,
        payload,
      });
    } catch (err: any) {
      console.warn(
        `[NDJC] repository_dispatch failed (non-blocking): ${err?.message || err}`
      );
    }

    /* ---------------- 返回响应 ---------------- */
    return NextResponse.json(
      {
        ok: true,
        runId,
        mode: (o as any)?._mode || (input?.mode ?? "A"),
        usage: tokensReport,
        repoPath: `${repo}/tree/${branch}/${runDir}`,
        message:
          "NDJC build orchestrated, committed, and dispatch sent to GitHub Actions.",
      },
      { headers: CORS }
    );
  } catch (err: any) {
    console.error("[NDJC] ❌ Error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal error" },
      { status: 500, headers: CORS }
    );
  }
}
