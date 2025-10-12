// app/api/generate-apk/route.ts
// 瘦路由（Node）：编排 /（可选）Contract v1 严格校验 / 写入 01/02/03 / 触发 GitHub Actions。

import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/ndjc/orchestrator";

// Contract v1 严格模式（→ 统一从 strict-json.ts 导入）
import { parseStrictJson, validateContractV1 } from "@/lib/ndjc/llm/strict-json";
import { contractV1ToPlan } from "@/lib/ndjc/contract/contractv1-to-plan";

export const runtime = "nodejs";

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
  // next/server 下可用的 web crypto
  const r = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(r).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}-${hex}`;
}
function b64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // Web 环境下有 btoa
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
  baseRef: string; // e.g. 'main'（工作流所在分支）
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

  // 1) 读取 baseRef 最新 commit SHA
  const baseRefData = await (await gh(headers, "GET", `${GH_API}/repos/${owner}/${repo}/git/ref/heads/${baseRef}`)).json();
  const baseSha: string = baseRefData.object.sha;

  // 2) 如果 runBranch 不存在，则创建
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

  // 3) 逐个以 contents API 提交（适合少量文件）
  for (const f of files) {
    const url = `${GH_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}`;
    // 先查 sha（如果该文件在分支上已存在）
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

    // —— 编排（在线为主，失败回退最小对象）——
    step = "orchestrate";
    let o: any;
    try {
      if (process.env.NDJC_OFFLINE === "1" || input?.offline === true) throw new Error("force-offline");
      if (!process.env.GROQ_API_KEY) throw new Error("groq-key-missing");
      const model = process.env.GROQ_MODEL || input?.model || "llama-3.1-8b-instant";
      o = await orchestrate({ ...input, provider: "groq", model, forceProvider: "groq" });
      o = { ...o, _mode: `online(${model})` };
    } catch (err: any) {
      o = {
        mode: input?.mode || "A",
        template: input?.template || "circle-basic",
        appName: input?.appName || input?.appTitle || "NDJC App",
        packageId: input?.packageId || input?.packageName || "com.ndjc.demo.app",
        _mode: `offline(${String(err?.message ?? err)})`,
      };
    }

    // —— Contract v1（严格开启）——
    const mustV1 = wantContractV1From(input);
    if (!mustV1) {
      return NextResponse.json(
        { ok: false, runId, step: "contract-required", error: "Contract v1 is required in strict mode." },
        { status: 400, headers: CORS }
      );
    }

    step = "contract-precheck";
    const raw = extractRawTraceText(o?._trace);
    if (!raw || !String(raw).trim()) {
      return NextResponse.json(
        {
          ok: false,
          contract: "v1",
          runId,
          step,
          reason: [{ code: "E_NOT_JSON", message: "No raw LLM text to validate", path: "<root>" }],
        },
        { status: 400, headers: CORS }
      );
    }

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
        { status: 400, headers: CORS }
      );
    }

    step = "contract-validate";
    const validation = await validateContractV1(parsed.data);
    if (!validation.ok) {
      return NextResponse.json(
        { ok: false, contract: "v1", runId, step, reason: validation.issues },
        { status: 400, headers: CORS }
      );
    }

    step = "contract-to-plan";
    const planV1 = contractV1ToPlan(parsed.data);

    // —— 合成带 trace 的 01（可控开关）——
    const includeTrace = (process.env.NDJC_TRACE_IN_CONTRACT || "1").trim() === "1";
    const trace = o?._trace || {};
    const promptFile = trace?.source?.prompt_file || null;
    const promptSha = trace?.source?.prompt_sha256 || null;
    const promptFromEnv = trace?.source?.loaded_from_env ?? null;

    const contractOut = includeTrace
      ? {
          ...parsed.data,
          // 把来源打点塞进 metadata，便于肉眼查看；同时保留完整 _trace
          metadata: {
            ...(parsed.data?.metadata || {}),
            trace: {
              prompt_file: promptFile,
              prompt_sha256: promptSha,
              prompt_loaded_from_env: promptFromEnv,
              model_mode: o?._mode || null,
            },
          },
          _trace: trace,
        }
      : parsed.data;

    // —— 先把 01/02/03 提交到 run 分支（严格守卫所需）——
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
      template: o?.template || planV1?.meta?.template || input?.template || "circle-basic",
      appTitle: o?.appName || planV1?.meta?.appName,
      packageName: o?.packageId || planV1?.meta?.packageId,
      note: "Apply result will be finalized in CI pipeline.",
      changes: [],
      warnings: [],
    };

    // 生成一个可读的 summary，带上提示词来源
    const summaryLines = [
      `created by api; mode=${o?._mode || "unknown"}`,
      includeTrace ? `prompt_file=${promptFile || ""}` : "",
      includeTrace ? `prompt_sha256=${promptSha || ""}` : "",
      includeTrace ? `prompt_loaded_from_env=${promptFromEnv}` : "",
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

    // —— 触发 CI（plan 仍作为 inputs 传过去，CI 可再次校验/物化）——
    step = "dispatch";
    const inputs = {
      runId,
      branch,
      template: applyStub.template,
      appTitle: applyStub.appTitle,
      packageName: applyStub.packageName,
      mode: o?.mode || input?.mode || "A",
      contract: "v1",
      planB64: b64(JSON.stringify(planV1)),
      orchestratorB64: undefined,
      clientNote: o?._mode || "unknown",
      preflight_mode: input?.preflight_mode || "strict",
    };

    if (process.env.NDJC_SKIP_ACTIONS === "1" || input?.skipActions === true) {
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
        { headers: CORS }
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
      { headers: CORS }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, runId, step, error: String(e?.message ?? e) }, { status: 500, headers: CORS });
  }
}
