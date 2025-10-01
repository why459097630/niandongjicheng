// app/api/generate-apk/route.ts
// 瘦路由（Edge/Node）：只做编排 /（可选）Contract v1 校验 / 触发 GitHub Actions。
// 物化、注入模板、推送与打包全在 CI 内执行。

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
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/* -------------- 小工具（Edge 兼容） -------------- */
function newRunId() {
  const r = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(r).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `ndjc-${new Date().toISOString().replace(/[:.]/g, "-")}-${hex}`;
}
function b64(str: string) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
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

/* -------------- 触发 GitHub Actions（Edge） -------------- */
async function dispatchWorkflow(inputs: any) {
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || "main";
  const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);
  const token = process.env.GH_PAT!;
  if (!owner || !repo || !wf || !token) {
    throw new Error("Missing GH_OWNER/GH_REPO/WORKFLOW_ID/GH_PAT");
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    Accept: "application/vnd.github+json",
  };

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: branch, inputs }),
  });

  if (!r.ok) {
    const text = await r.text();
    if (r.status === 422) {
      const url2 = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
      const r2 = await fetch(url2, {
        method: "POST",
        headers,
        body: JSON.stringify({ event_type: "generate-apk", client_payload: inputs }),
      });
      if (!r2.ok) throw new Error(`GitHub 422 fallback failed: ${await r2.text()}`);
      return { degraded: true };
    }
    throw new Error(`GitHub ${r.status} ${r.statusText}: ${text}`);
  }
  return { degraded: false };
}

/* ---------------- 路由主逻辑（Edge） ---------------- */
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

    // —— Contract v1（可选）——
    const v1 = wantContractV1From(input);
    let planV1: any | null = null;
    if (v1) {
      step = "contract-precheck";
      const raw = extractRawTraceText(o?._trace);
      if (!raw || !String(raw).trim()) {
        return NextResponse.json(
          {
            ok: false,
            contract: "v1",
            degrade: true,
            runId,
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
            degrade: true,
            runId,
            reason: [{ code: "E_NOT_JSON", message: parsed.error, path: "<root>" }],
          },
          { status: 400, headers: CORS }
        );
      }

      step = "contract-validate";
      const validation = await validateContractV1(parsed.data);
      if (!validation.ok) {
        return NextResponse.json(
          { ok: false, contract: "v1", degrade: true, runId, reason: validation.issues },
          { status: 400, headers: CORS }
        );
      }

      step = "contract-to-plan";
      planV1 = contractV1ToPlan(parsed.data);
    }

    // —— 触发 CI（把 plan/orchestrator 作为 inputs 传过去）——
    step = "dispatch";
    const branch = `ndjc-run/${runId}`;
    const actionsInputs = {
      runId,
      branch,
      template: o?.template || input?.template || "circle-basic",
      appTitle: o?.appName,
      packageName: o?.packageId,
      mode: o?.mode || input?.mode || "A",
      contract: v1 ? "v1" : "legacy",
      planB64: planV1 ? b64(JSON.stringify(planV1)) : undefined,
      orchestratorB64: !planV1 ? b64(JSON.stringify(o)) : undefined,
      clientNote: o?._mode || "unknown",
      preflight_mode: input?.preflight_mode || "warn",
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
          mode: o?.mode || "A",
          contract: actionsInputs.contract,
        },
        { headers: CORS }
      );
    }

    const res = await dispatchWorkflow(actionsInputs);
    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;
    const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);
    const actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${wf}`;

    return NextResponse.json(
      {
        ok: true,
        runId,
        branch,
        actionsUrl,
        degraded: res.degraded,
        mode: o?.mode || "A",
        contract: actionsInputs.contract,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, runId, step, error: String(e?.message ?? e) }, { status: 500, headers: CORS });
  }
}
