// app/api/generate-apk/route.ts
// 瘦路由（Node）：编排 /（可选）Contract v1 严格校验 / 写入 01/02/03 / 触发 GitHub Actions。

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/ndjc/orchestrator";

// Contract v1 严格模式
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";

/* ---------------- CORS ---------------- */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/* -------------- 小工具 -------------- */
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
function b64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // @ts-ignore
  return btoa(bin);
}
function normalizeWorkflowId(wf: string) {
  if (/^\d+$/.test(wf)) return wf;
  return wf.endsWith(".yml") ? wf : `${wf}.yml`;
}
function extractRawTraceText(trace: any): string | null {
  if (!trace) return null;
  return (
    trace.rawText ??
    trace.text ??
    trace.response?.text ??
    trace.response?.body ??
    trace.response?.choices?.[0]?.message?.content ??
    null
  );
}
function wantContractV1From(input: any) {
  const envRaw = (process.env.NDJC_CONTRACT_V1 || "").trim().toLowerCase();
  return (
    input?.contract === "v1" ||
    input?.contractV1 === true ||
    envRaw === "1" ||
    envRaw === "true" ||
    envRaw === "v1"
  );
}

/* -------------- GitHub 简易工具 -------------- */
const GH_API = "https://api.github.com";

async function gh(headers: Record<string, string>, method: string, url: string, body?: any) {
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
  baseRef: string; // e.g. 'main'
  runBranch: string; // e.g. 'ndjc-run/<runId>'
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
  const baseRefData = await (await gh(headers, "GET", `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${baseRef}`)).json();
  const baseSha: string = baseRefData.object.sha;

  // 2) 创建 runBranch（若不存在）
  let hasRunBranch = true;
  try {
    await gh(headers, "GET", `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${runBranch}`);
  } catch {
    hasRunBranch = false;
  }
  if (!hasRunBranch) {
    await gh(headers, "POST", `${GH_API}/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${runBranch}`,
      sha: baseSha,
    });
  }

  // 3) 以 contents API 提交少量文件
  for (const f of files) {
    const url = `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`;
    // 读取 sha（如果已存在）
    let sha: string | undefined;
    try {
      const existing = await (await gh(headers, "GET", `${url}?ref=${runBranch}`)).json();
      sha = existing.sha;
    } catch {
      sha = undefined;
    }
    await gh(headers, "PUT", url, {
      message: `NDJC: materialize ${runBranch} -> ${f.path}`,
      // @ts-ignore
      content: btoa(unescape(encodeURIComponent(f.content))), // utf8 -> base64
      branch: runBranch,
      sha,
    });
  }
}

async function dispatchWorkflow(inputs: any) {
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || "main";
  const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);
  const token = process.env.GH_PAT!;
  if (!owner || !repo || !wf || !token) {
    throw new Error("Missing GH_OWNER/GH_REPO/WORKFLOW_ID/GH_PAT");
  }

  const url = `${GH_API}/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: branch, inputs }),
  });

  if (!r.ok) {
    const text = await r.text();
    if (r.status === 422) {
      // Fallback: repository_dispatch
      const url2 = `${GH_API}/repos/${owner}/${repo}/dispatches`;
      const r2 = await fetch(url2, {
        method: "POST",
        headers,
        body: JSON.stringify({ event_type: "generate-apk", client_payload: inputs }),
      });
      if (!r2.ok) throw new Error(`GitHub 422 fallback failed: ${await r2.text()}`);
      return { degraded: true, owner, repo, wf, branch };
    }
    throw new Error(`GitHub ${r.status} ${r.statusText}: ${text}`);
  }
  return { degraded: false, owner, repo, wf, branch };
}

/* ---------------- 路由主逻辑 ---------------- */
export async function POST(req: NextRequest) {
  let step = "start";
  const runId = newRunId();

  try {
    step = "parse-input";
    const input = await req.json().catch(() => ({} as any));

    // —— 合同版本要求 —— //
    const mustV1 = wantContractV1From(input);
    if (!mustV1) {
      return NextResponse.json(
        { ok: false, runId, step: "contract-required", error: "Contract v1 is required in strict mode." },
        { status: 422, headers: CORS }
      );
    }

    // —— 调 orchestrator（默认在线，失败回退离线；把错误映射为 422）——
    step = "orchestrate";
    let o: any;
    const forceOffline = process.env.NDJC_OFFLINE === "1" || input?.offline === true;

    if (forceOffline) {
      o = await orchestrate({ ...input, provider: "offline", forceProvider: "offline" });
      o = { ...o, _mode: "offline(forced)" };
    } else {
      try {
        if (!process.env.GROQ_API_KEY) {
          return NextResponse.json(
            { ok: false, runId, step, error: "groq-key-missing" },
            { status: 500, headers: CORS }
          );
        }
        const model = process.env.GROQ_MODEL || input?.model || "llama-3.1-8b-instant";
        o = await orchestrate({ ...input, provider: "groq", model, forceProvider: "groq" });
        o = { ...o, _mode: `online(${model})` };
      } catch (err: any) {
        const code = Number(err?.status || 0);
        const msg = String(err?.message || "LLM upstream error");
        const trace = (err as any)?.trace || undefined;

        return NextResponse.json(
          {
            ok: false,
            runId,
            step: "orchestrate-online",
            error: msg,
            upstreamStatus: code || undefined,
            meta: trace ? { _trace: trace } : undefined,
          },
          { status: 422, headers: CORS }
        );
      }
    }

    // —— Contract v1 预检（优先用 raw；没有 raw 时尝试对象态） —— //
    step = "contract-precheck";
    const raw =
      (o as any)?.raw ??
      (o as any)?.trace?.raw_llm_text ??
      (o as any)?.trace?.retry_raw_llm_text ??
      extractRawTraceText((o as any)?._trace) ??
      "";

    let contractObj: any | null = null;
    let precheckNote: string | null = null;

    if (raw && String(raw).trim().length > 0) {
      // 有 raw：严格按纯文本解析
      step = "contract-parse";
      const parsed = parseStrictJson(raw);
      if (!parsed.ok) {
        return NextResponse.json(
          {
            ok: false,
            contract: "v1",
            runId,
            step,
            reason: [{ code: "E_NOT_JSON", message: parsed.error, path: "<root>" }],
          },
          { status: 422, headers: CORS }
        );
      }
      contractObj = parsed.data;
    } else {
      // 没有 raw：尝试对象态来源（single-call + local-fix 场景）
      precheckNote = "no_raw_text_used_object_mode";
      contractObj =
        (o as any)?.contract ??
        (o as any)?.data ??
        (o as any)?.contractV1 ??
        (o as any)?.parsed ??
        null;

      if (!contractObj) {
        return NextResponse.json(
          {
            ok: false,
            contract: "v1",
            runId,
            step,
            reason: [{ code: "E_NOT_JSON", message: "No raw LLM text and no object-mode contract", path: "<root>" }],
          },
          { status: 422, headers: CORS }
        );
      }
    }

    // —— 严格校验 —— //
    step = "contract-validate";
    const validation = await validateContractV1(contractObj);
    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          contract: "v1",
          runId,
          step,
          reason: validation.issues,
          meta: precheckNote ? { precheckNote } : undefined,
        },
        { status: 422, headers: CORS }
      );
    }

    // —— 生成 plan —— //
    step = "contract-to-plan";
    const planV1 = contractV1ToPlan(contractObj);

    // —— 合成带 trace 的 01（可控开关）——
    const includeTrace = (process.env.NDJC_TRACE_IN_CONTRACT || "1").trim() === "1";
    const trace = (o as any)?.trace || (o as any)?._trace || {};
    const promptFile = trace?.source?.prompt_file || null;
    const promptSha = trace?.source?.prompt_sha256 || null;
    const promptFromEnv = trace?.source?.loaded_from_env ?? null;

    const contractOut = includeTrace
      ? {
          ...contractObj,
          metadata: {
            ...(contractObj?.metadata || {}),
            trace: {
              prompt_file: promptFile,
              prompt_sha256: promptSha,
              prompt_loaded_from_env: promptFromEnv,
              model_mode: (o as any)?._mode || null,
              precheck_note: precheckNote || null,
            },
          },
          _trace: trace,
        }
      : contractObj;

    // —— 提交 01/02/03 到 run 分支 —— //
    step = "commit-requests";
    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;
    const token = process.env.GH_PAT!;
    const wfBranch = process.env.GH_BRANCH || "main";
    if (!owner || !repo || !token) {
      return NextResponse.json(
        { ok: false, runId, step, error: "Missing GH_OWNER/GH_REPO/GH_PAT" },
        { status: 500, headers: CORS }
      );
    }
    const branch = `ndjc-run/${runId}`;
    const runDir = `requests/${runId}`;

    const applyStub = {
      runId,
      status: "pre-ci",
      template: (o as any)?.template || (planV1 as any)?.meta?.template || (input as any)?.template || "circle-basic",
      appTitle: (o as any)?.appName || (planV1 as any)?.meta?.appName,
      packageName: (o as any)?.packageId || (planV1 as any)?.meta?.packageId,
      note: "Apply result will be finalized in CI pipeline.",
      changes: [] as any[],
      warnings: [] as any[],
    };

    const summaryLines = [
      `created by api; mode=${(o as any)?._mode || "unknown"}`,
      includeTrace ? `prompt_file=${promptFile || ""}` : "",
      includeTrace ? `prompt_sha256=${promptSha || ""}` : "",
      includeTrace ? `prompt_loaded_from_env=${promptFromEnv}` : "",
      precheckNote ? `precheck_note=${precheckNote}` : "",
    ].filter(Boolean);

    await ensureRunBranchAndCommitFiles({
      owner,
      repo,
      baseRef: wfBranch,
      runBranch: branch,
      token,
      files: [
        { path: `${runDir}/01_contract.json`, content: JSON.stringify(contractOut, null, 2) },
        { path: `${runDir}/02_plan.json`, content: JSON.stringify(planV1, null, 2) },
        { path: `${runDir}/03_apply_result.json`, content: JSON.stringify(applyStub, null, 2) },
        { path: `${runDir}/actions-summary.txt`, content: summaryLines.join("\n") },
      ],
    });

    // —— 触发 CI —— //
    step = "dispatch";
    const inputs = {
      runId,
      branch,
      template: applyStub.template,
      appTitle: applyStub.appTitle,
      packageName: applyStub.packageName,
      mode: (o as any)?.mode || (input as any)?.mode || "A",
      contract: "v1",
      planB64: b64(JSON.stringify(planV1)),
      orchestratorB64: undefined,
      clientNote: (o as any)?._mode || "unknown",
      preflight_mode: (input as any)?.preflight_mode || "strict",
    };

    if (process.env.NDJC_SKIP_ACTIONS === "1" || (input as any)?.skipActions === true) {
      return NextResponse.json(
        {
          ok: true,
          runId,
          branch,
          skipped: "actions",
          actionsUrl: null,
          degraded: null,
          mode: inputs.mode,
          contract: inputs.contract,
        },
        { status: 200, headers: CORS }
      );
    }

    const res = await dispatchWorkflow(inputs);
    const actionsUrl = `https://github.com/${res.owner}/${res.repo}/actions/workflows/${res.wf}`;

    return NextResponse.json(
      {
        ok: true,
        runId,
        branch,
        actionsUrl,
        degraded: res.degraded,
        mode: inputs.mode,
        contract: inputs.contract,
      },
      { status: 200, headers: CORS }
    );
  } catch (e: any) {
    // 兜底：真正代码异常 -> 500
    return NextResponse.json({ ok: false, runId, step, error: String(e?.message ?? e) }, { status: 500, headers: CORS });
  }
}
