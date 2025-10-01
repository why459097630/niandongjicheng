// app/api/generate-apk/route.ts
// 瘦路由（Node.js）：编排 /（可选）Contract v1 校验 / 触发 GitHub Actions

import { NextRequest, NextResponse } from 'next/server';
import { orchestrate } from '@/lib/ndjc/orchestrator';
import { randomBytes } from 'node:crypto';

// Contract v1
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

/* -------------- helpers -------------- */
function newRunId() {
  return `ndjc-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
}
function b64(s: string) { return Buffer.from(s ?? '', 'utf8').toString('base64'); }
function normalizeWorkflowId(wf: string) {
  if (!wf) return '';
  if (/^\d+$/.test(wf)) return wf;
  return wf.endsWith('.yml') ? wf : `${wf}.yml`;
}
function extractRawTraceText(t: any): string | null {
  return (
    t?.rawText ??
    t?.text ??
    t?.response?.text ??
    t?.response?.body ??
    t?.response?.choices?.[0]?.message?.content ??
    null
  );
}
function wantContractV1From(input: any) {
  const envRaw = (process.env.NDJC_CONTRACT_V1 || '').trim().toLowerCase();
  return input?.contract === 'v1' || input?.contractV1 === true || ['1','true','v1'].includes(envRaw);
}

/* -------------- GitHub dispatch -------------- */
type GhCall = { kind: 'workflow_dispatch' | 'repository_dispatch', status: number, ok: boolean, text?: string };

async function tryWorkflowDispatch(inputs: any): Promise<GhCall> {
  const owner  = process.env.GH_OWNER!;
  const repo   = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || 'main';
  const wf     = normalizeWorkflowId(process.env.WORKFLOW_ID!);
  const token  = process.env.GH_PAT!;
  const url    = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wf}/dispatches`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: branch, inputs }),
  });
  const text = await r.text().catch(()=>'');
  return { kind: 'workflow_dispatch', status: r.status, ok: r.ok, text };
}
async function tryRepoDispatch(inputs: any): Promise<GhCall> {
  const owner  = process.env.GH_OWNER!;
  const repo   = process.env.GH_REPO!;
  const token  = process.env.GH_PAT!;
  const url    = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'generate-apk', client_payload: inputs }),
  });
  const text = await r.text().catch(()=>'');
  return { kind: 'repository_dispatch', status: r.status, ok: r.ok, text };
}

/* ---------------- main ---------------- */
export async function POST(req: NextRequest) {
  let step = 'start';
  const runId = newRunId();

  try {
    step = 'parse-input';
    const input = await req.json().catch(() => ({} as any));

    // —— 编排 —— //
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

    // —— Contract v1（可选） —— //
    const v1 = wantContractV1From(input);
    let planV1: any | null = null;
    if (v1) {
      step = 'contract-precheck';
      const raw = extractRawTraceText(o?._trace);
      if (!raw || !String(raw).trim()) {
        return NextResponse.json(
          { ok: false, contract: 'v1', degrade: true, runId,
            reason: [{ code: 'E_NOT_JSON', message: 'No raw LLM text to validate', path: '<root>' }] },
          { status: 400, headers: CORS }
        );
      }
      step = 'contract-parse';
      const parsed = parseStrictJson(raw);
      if (!parsed.ok) {
        return NextResponse.json(
          { ok: false, contract: 'v1', degrade: true, runId,
            reason: [{ code: 'E_NOT_JSON', message: parsed.error, path: '<root>' }] },
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

    // —— 触发 CI —— //
    step = 'dispatch';
    const branch = `ndjc-run/${runId}`;
    const actionsInputs: Record<string, any> = {
      runId, branch,
      template: o?.template || input?.template || 'circle-basic',
      appTitle: o?.appName,
      packageName: o?.packageId,
      mode: o?.mode || input?.mode || 'A',
      contract: v1 ? 'v1' : 'legacy',
      planB64: planV1 ? b64(JSON.stringify(planV1)) : undefined,
      orchestratorB64: !planV1 ? b64(JSON.stringify(o)) : undefined,
      clientNote: o?._mode || 'unknown',
      preflight_mode: input?.preflight_mode || 'warn',
    };

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      return NextResponse.json(
        { ok: true, runId, branch, skipped: 'actions', actionsUrl: null,
          degraded: null, mode: o?.mode || 'A', contract: actionsInputs.contract },
        { headers: CORS }
      );
    }

    // 先尝试 workflow_dispatch，失败再回退 repository_dispatch
    const ghHistory: GhCall[] = [];
    const r1 = await tryWorkflowDispatch(actionsInputs);
    ghHistory.push(r1);
    let degraded = false;

    if (!r1.ok) {
      const r2 = await tryRepoDispatch(actionsInputs);
      ghHistory.push(r2);
      if (!r2.ok) {
        // 两种都失败：把详细信息直接抛给前端，便于定位权限/文件名/分支等问题
        console.error('[NDJC] dispatch failed', { step, runId, ghHistory });
        return NextResponse.json(
          { ok: false, runId, step: 'dispatch', ghHistory,
            hint: 'Check GH_OWNER/GH_REPO/WORKFLOW_ID/GH_PAT scopes & whether workflow exists on GH_BRANCH.' },
          { status: 502, headers: CORS }
        );
      }
      degraded = true;
    }

    const owner = process.env.GH_OWNER!;
    const repo  = process.env.GH_REPO!;
    const wf    = normalizeWorkflowId(process.env.WORKFLOW_ID!);
    const actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${wf}`;

    return NextResponse.json(
      { ok: true, runId, branch, actionsUrl, degraded, mode: o?.mode || 'A',
        contract: actionsInputs.contract, ghHistory },
      { headers: CORS }
    );

  } catch (e: any) {
    console.error('[NDJC] route error', { step, runId, error: String(e?.message ?? e) });
    return NextResponse.json(
      { ok: false, runId, step, error: String(e?.message ?? e) },
      { status: 500, headers: CORS }
    );
  }
}
