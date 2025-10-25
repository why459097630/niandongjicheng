// app/api/generate-apk/route.ts
// 两阶段 orchestrator -> GitHub materialize -> 触发 Actions
// 注意：这是“公开调用就能触发你 GitHub Actions”的版本，请确保你信任流量来源，或者加鉴权

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

/* -------------- base64 util (for planB64 in workflow inputs) -------------- */
function utf8ToBase64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // @ts-ignore
  return btoa(bin);
}

/* -------------- GitHub helpers -------------- */
const GH_API = "https://api.github.com";

function normalizeWorkflowId(wf: string) {
  if (/^\d+$/.test(wf)) return wf;        // workflow numeric ID is okay
  return wf.endsWith(".yml") ? wf : `${wf}.yml`;
}

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

// 把我们要交给 CI 的几份文件推到一个 run 分支：requests/<runId>/...
async function ensureRunBranchAndCommitFiles(args: {
  owner: string;
  repo: string;
  baseRef: string;  // e.g. "main"
  runBranch: string; // e.g. "ndjc-run/<runId>"
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

  // 1) 获取 baseRef 最新 commit SHA
  const baseRefData = await (
    await gh(
      headers,
      "GET",
      `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${baseRef}`
    )
  ).json();
  const baseSha: string = baseRefData.object.sha;

  // 2) 确保 runBranch 存在，不存在就从 baseRef 创建
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

  // 3) 用 contents API 逐个 PUT 文件到 runBranch
  for (const f of files) {
    const url = `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      f.path
    )}`;

    // 检查文件是否已存在，拿 sha 做更新，否则创建
    let sha: string | undefined;
    try {
      const existing = await (
        await gh(
          headers,
          "GET",
          `${url}?ref=${runBranch}`
        )
      ).json();
      sha = existing.sha;
    } catch {
      sha = undefined;
    }

    await gh(headers, "PUT", url, {
      message: `NDJC: materialize ${runBranch} -> ${f.path}`,
      content: toBase64ForGitHub(f.content),
      branch: runBranch,
      sha,
    });
  }
}

// GitHub的contents API要求Base64（标准RFC 4648，无换行）
function toBase64ForGitHub(plain: string) {
  // since utf8ToBase64() already gives us base64 with no newlines, we reuse it.
  return utf8ToBase64(plain);
}

// 调用 workflow_dispatch 或降级 repository_dispatch
async function dispatchWorkflow(inputs: any) {
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || "main";
  const wf = normalizeWorkflowId(process.env.WORKFLOW_ID || "");
  const token = process.env.GH_PAT!;

  if (!owner || !repo || !wf || !token) {
    throw new Error("Missing GH_OWNER/GH_REPO/WORKFLOW_ID/GH_PAT");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // 尝试 workflow_dispatch
  const first = await fetch(
    `${GH_API}/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: branch, inputs }),
    }
  );

  if (first.ok) {
    return { degraded: false, owner, repo, wf, branch };
  }

  // workflow_dispatch 不给过，尝试 repository_dispatch 兜底
  if (first.status === 422) {
    const second = await fetch(`${GH_API}/repos/${owner}/${repo}/dispatches`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event_type: "generate-apk",
        client_payload: inputs,
      }),
    });
    if (!second.ok) {
      const text = await second.text();
      throw new Error(`GitHub 422 fallback failed: ${text}`);
    }
    return { degraded: true, owner, repo, wf, branch };
  }

  const txt = await first.text();
  throw new Error(
    `GitHub ${first.status} ${first.statusText}: ${txt}`
  );
}

/* ---------------- 路由主逻辑 ---------------- */
export async function POST(req: NextRequest) {
  let step = "start";
  const runId = newRunId();

  try {
    step = "parse-input";
    const input = await req.json().catch(() => ({} as any));

    // 整理成 orchestrator 需要的最小输入
    const requirement: string =
      (input.requirement ??
        input.nl ??
        input.prompt ??
        "") as string;

    const templateKey: string =
      (input.template_key ??
        input.template ??
        "circle-basic") as string;

    const mode: string = (input.mode ?? "A") as string;

    step = "orchestrate-two-phase";

    // 调用两阶段 orchestrator（orchestrate 已经是两阶段别名）
    // orchestrate 返回：
    // {
    //   ok, runId, plan, phase1Spec, violations, usage, debug
    // }
    const orches = await orchestrate({
      requirement,
      template_key: templateKey,
      runId,
      mode,
    } as any);

    // 如果phase2校验没通过，直接422结束；不进GitHub
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

    // -----------------------------
    // 走到这里说明我们拿到了最终合格的 contract (orches.plan)
    // 现在把它materialize到 GitHub 分支并触发 workflow
    // -----------------------------
    step = "materialize-to-github";

    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;
    const baseBranch = process.env.GH_BRANCH || "main";
    const token = process.env.GH_PAT!;
    if (!owner || !repo || !token) {
      // 如果没配这些环境变量，我们就当本次只能本地返回，不触发CI
      return NextResponse.json(
        {
          ok: true,
          runId: orches.runId ?? runId,
          step: "done-no-ci",
          contract: orches.plan,
          phase1Spec: orches.phase1Spec ?? null,
          usage: orches.usage ?? null,
          debug: orches.debug ?? null,
          note: "Missing GH_OWNER/GH_REPO/GH_PAT, skipped CI dispatch.",
        },
        { status: 200, headers: CORS }
      );
    }

    // 组装要提交到 repo 的文件
    const branch = `ndjc-run/${runId}`;
    const runDir = `requests/${runId}`;

    // contractOut: 直接把 orches.plan 当作最终契约
    // applyStub: 给后续CI的一个apply_result占位
    const contractOut = orches.plan;
    const applyStub = {
      runId,
      status: "pre-ci",
      template: templateKey,
      appTitle:
        contractOut?.metadata?.appName ??
        contractOut?.anchorsGrouped?.text?.["NDJC:APP_LABEL"] ??
        null,
      packageName:
        contractOut?.metadata?.packageId ??
        contractOut?.anchorsGrouped?.text?.["NDJC:PACKAGE_NAME"] ??
        null,
      note: "Apply result will be finalized in CI pipeline.",
      changes: [] as any[],
      warnings: [] as any[],
    };

    // 准备 summaryLines 作为 actions-summary.txt
    const summaryLines = [
      `created by api; mode=${mode}`,
      `template=${templateKey}`,
      `runId=${runId}`,
    ];

    // 注意：我们也可以把 phase1Spec / debug / usage 写进 repo，但这会暴露更多LLM细节到git历史。
    // 现在先写3+1个文件，和之前版本类似。
    await ensureRunBranchAndCommitFiles({
      owner,
      repo,
      baseRef: baseBranch,
      runBranch: branch,
      token,
      files: [
        {
          path: `${runDir}/01_contract.json`,
          content: JSON.stringify(contractOut, null, 2),
        },
        {
          path: `${runDir}/02_phase1Spec.json`,
          content: JSON.stringify(orches.phase1Spec ?? {}, null, 2),
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

    // -----------------------------
    // 触发 GitHub Actions workflow
    // -----------------------------
    step = "dispatch-workflow";

    const skipActions =
      process.env.NDJC_SKIP_ACTIONS === "1" ||
      input?.skipActions === true;

    if (skipActions) {
      return NextResponse.json(
        {
          ok: true,
          runId,
          branch,
          skipped: "actions",
          actionsUrl: null,
          degraded: null,
          mode,
          contract: "v1",
          contractOut,
          usage: orches.usage ?? null,
          debug: orches.debug ?? null,
        },
        { status: 200, headers: CORS }
      );
    }

    // workflow inputs（传给你的CI脚本）
    // 你CI侧可以 base64 解出 plan，再继续编译APK
    const planB64 = utf8ToBase64(JSON.stringify(contractOut));
    const wfInputs = {
      runId,
      branch,
      template: templateKey,
      appTitle: applyStub.appTitle || "",
      packageName: applyStub.packageName || "",
      mode,
      contract: "v1",
      planB64,
      clientNote: "ndjc-public-api",
      preflight_mode: "strict",
    };

    const wfRes = await dispatchWorkflow(wfInputs);

    const actionsUrl = `https://github.com/${wfRes.owner}/${wfRes.repo}/actions/workflows/${wfRes.wf}`;

    return NextResponse.json(
      {
        ok: true,
        runId,
        branch,
        actionsUrl,
        degraded: wfRes.degraded,
        mode,
        contract: "v1",
        usage: orches.usage ?? null,
        debug: orches.debug ?? null,
      },
      { status: 200, headers: CORS }
    );
  } catch (e: any) {
    // 兜底：代码异常 -> 500
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
