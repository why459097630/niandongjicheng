// app/api/generate-apk/route.ts
// 瘦路由（Node.js）：只做编排 /（可选）Contract v1 校验 / 触发 GitHub Actions。
// 物化、注入模板、推送与打包全在 CI 内执行。

import { NextRequest, NextResponse } from 'next/server';
import { orchestrate } from '@/lib/ndjc/orchestrator';
import { randomBytes } from 'node:crypto';

// Contract v1 严格模式（→ 统一从 strict-json.ts 导入）
import { parseStrictJson, validateContractV1 } from '@/lib/ndjc/llm/strict-json';
import { contractV1ToPlan } from '@/lib/ndjc/contract/contractv1-to-plan';

export const runtime = 'nodejs';

/* ---------------- CORS ---------------- */
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/* -------------- 小工具（Node 兼容） -------------- */
function newRunId() {
  const hex = randomBytes(6).toString('hex');
  return `ndjc-${new Date().toISOString().replace(/[:.]/g, '-')}-${hex}`;
}
function b64(str: string) {
  return Buffer.from(str ?? '', 'utf8').toString('base64');
}
function normalizeWorkflowId(wf: string) {
  if (/^\d+$/.test(wf)) return wf;
  return wf.endsWith('.yml') ? wf : `${wf}.yml`;
}
function extractRawTraceText(trace: any): string | null {
  if (!trace) return null;
  return (
    (trace as any).rawText ??
    (trace as any).text ??
    (trace as any).response?.text ??
    (trace as any).response?.body ??
    (trace as any).response?.choices?.[0]?.message?.content ??
    null
  );
}
function wantContractV1From(input: any) {
  const envRaw = (process.env.NDJC_CONTRACT_V1 || '').trim().toLowerCase();
  return (
    input?.contract === 'v1' ||
    input?.contractV1 === true ||
    envRaw === '1' ||
    envRaw === 'true' ||
    envRaw === 'v1'
  );
}

/* -------------- 触发 GitHub Actions（双保险） -------------- */
async function dispatchWorkflow(inputs: any) {
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || 'main';
  const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);
  const token = process.env.GH_PAT!;
  if (!owner || !repo || !wf || !token) {
    throw new Error('Missing GH_OWNER/GH_REPO/WORKFLOW_ID/GH_PAT');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };

  const forceRepo = (process.env.NDJC_FORCE_REPO_DISPATCH || '').trim() === '1';
  const wantDebug = (process.env.NDJC_DISPATCH_DEBUG || '').trim() === '1';

  let okWF = false, okRepo = false;
  let wfStatus = 0, repoStatus = 0;
  let wfText = '', repoText = '';

  // 1) 优先 workflow_dispatch（除非强制 repo dispatch）
  if (!forceRepo) {
    const urlWF = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
    const r1 = await fetch(urlWF, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: branch, inputs }),
    });
    okWF = r1.ok;
    wfStatus = r1.status;
    if (!okWF && wantDebug) wfText = await r1.text().catch(() => '');
  }

  // 2) 兜底 repository_dispatch（总是补打一发，交给 concurrency 去重）
  const urlRepo = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const r2 = await fetch(urlRepo, {
    method: 'POST',
    headers,
    body: JSON.stringify({ event_type: 'generate-apk', client_payload: inputs }),
  });
  okRepo = r2.ok;
  repoStatus = r2.status;
  if (!okRepo && wantDebug) repoText = await r2.text().catch(() => '');

  if (okWF || okRepo) {
    return { degraded: !okWF, debug: wantDebug ? { wfStatus, repoStatus, wfText, repoText } : undefined };
  }

  throw new Error(
    `dispatch failed: workflow_dispatch=${wfStatus} ${wfText || 'failed'}; repository_dispatch=${repoStatus} ${repoText || 'failed'}`
  );
}

/* ---------------- 路由主逻辑 ---------------- */
export async function POST(req: NextRequest) {
  let step = 'start';
  const runId = newRunId();

  try {
    step = 'parse-input';
    const input = await req.json().catch(() => ({} as any));

    // —— 编排（在线为主，失败回退最小对象）——
    step = 'orchestrate';
    let o: any;
    try {
      if (process.env.NDJC_OFFLINE === '1' || input?.offline === true) throw new Error('force-offline');
      if (!process.env.GROQ_API_KEY) throw new Error('groq-key-missing');

      const model = process.env.GROQ_MODEL || input?.model || 'llama-3.1-8b-instant';
      o = await orchestrate({ ...input, provider: 'groq', model, forceProvider: 'groq' } as any);
      o = { ...o, _mode: `online(${model})` };
    } catch (err: any) {
      o = {
        mode: input?.mode || 'A',
        template: input?.template || 'circle-basic',
        appName: input?.appName || input?.appTitle || 'NDJC App',
        packageId: input?.packageId || input?.packageName || 'com.ndjc.demo.app',
        _mode: `offline(${String(err?.message ?? err)})`,
      };
    }

    // —— Contract v1（可选）——
    const v1 = wantContractV1From(input);
    let planV1: any | null = null;
    if (v1) {
      step = 'contract-precheck';
      const raw = extractRawTraceText(o?._trace);
      if (!raw || !String(raw).trim()) {
        return NextResponse.json(
          { ok: false, contract: 'v1', degrade: true, runId, reason: [{ code: 'E_NOT_JSON', message: 'No raw LLM text to validate', path: '<root>' }] },
          { status: 400, headers: CORS }
        );
      }
      step = 'contract-parse';
      const parsed = parseStrictJson(raw);
      if (!parsed.ok) {
        return NextResponse.json(
          { ok: false, contract: 'v1', degrade: true, runId, reason: [{ code: 'E_NOT_JSON', message: parsed.error, path: '<root>' }] },
          { status: 400, headers: CORS }
        );
      }
      step = 'contract-validate';
      const validation = await validateContractV1(parsed.data);
      if (!validation.ok) {
        return NextResponse.json(
          { ok: false, contract: 'v1', degrade: true, runId, reason: validation.issues },
          { status: 400, headers: CORS }
        );
      }
      step = 'contract-to-plan';
      planV1 = contractV1ToPlan(parsed.data as any);
    }

    // —— 触发 CI（把 plan/orchestrator 作为 inputs 传过去）——
    step = 'dispatch';
    const branch = `ndjc-run/${runId}`;
    const actionsInputs: Record<string, any> = {
      runId,
      branch,
      template: (o as any)?.template || input?.template || 'circle-basic',
      appTitle: (o as any)?.appName,
      packageName: (o as any)?.packageId,
      mode: (o as any)?.mode || input?.mode || 'A',
      contract: v1 ? 'v1' : 'legacy',
      planB64: planV1 ? b64(JSON.stringify(planV1)) : undefined,
      orchestratorB64: !planV1 ? b64(JSON.stringify(o)) : undefined,
      clientNote: (o as any)?._mode || 'unknown',
      preflight_mode: input?.preflight_mode || 'warn',
    };

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      return NextResponse.json(
        { ok: true, runId, branch, skipped: 'actions', actionsUrl: null, degraded: null, mode: (o as any)?.mode || 'A', contract: actionsInputs.contract },
        { headers: CORS }
      );
    }

    const res = await dispatchWorkflow(actionsInputs);
    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;
    const wf = normalizeWorkflowId(process.env.WORKFLOW_ID!);
    const actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${wf}`;

    // 可选：调试信息，仅在 NDJC_DISPATCH_DEBUG=1 时返回
    const extra: Record<string, any> = {};
    if ((process.env.NDJC_DISPATCH_DEBUG || '').trim() === '1' && (res as any).debug) {
      extra.dispatchDebug = (res as any).debug;
    }

    return NextResponse.json(
      {
        ok: true,
        runId,
        branch,
        actionsUrl,
        degraded: (res as any).degraded,
        mode: (o as any)?.mode || 'A',
        contract: actionsInputs.contract,
        ...extra,
      },
      { headers: CORS }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, runId, step, error: String(e?.message ?? e) },
      { status: 500, headers: CORS }
    );
  }
}
