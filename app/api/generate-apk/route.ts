// app/api/generate-apk/route.ts
// 瘦路由（Node.js）：编排 →（可选）V1 校验/转计划 → 触发 GitHub Actions（双通道）。
// 打包与模板注入都在 CI 内执行。

import { NextRequest, NextResponse } from 'next/server';
import { orchestrate } from '@/lib/ndjc/orchestrator';
import { randomBytes } from 'node:crypto';

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

/* -------------- 小工具 -------------- */
function newRunId() {
  const hex = randomBytes(6).toString('hex');
  return `ndjc-${new Date().toISOString().replace(/[:.]/g, '-')}-${hex}`;
}
function b64(str: string) {
  return Buffer.from(str ?? '', 'utf8').toString('base64');
}
function normalizeWorkflowId(wf: string | undefined | null) {
  if (!wf) return '';
  if (/^\d+$/.test(wf)) return wf;
  return wf.endsWith('.yml') ? wf : `${wf}.yml`;
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
  const envRaw = (process.env.NDJC_CONTRACT_V1 || '').trim().toLowerCase();
  return (
    input?.contract === 'v1' ||
    input?.contractV1 === true ||
    envRaw === '1' || envRaw === 'true' || envRaw === 'v1'
  );
}

/* ---- GitHub 调用小工具 ---- */
async function ghFetch(url: string, init: any) {
  const r = await fetch(url, init);
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, statusText: r.statusText, text };
}
async function getDefaultBranch(owner: string, repo: string, token: string) {
  const { ok, text } = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!ok) return 'main';
  try {
    const j = JSON.parse(text);
    return j.default_branch || 'main';
  } catch { return 'main'; }
}

/* -------------- 触发 GitHub Actions（双通道） -------------- */
async function dispatchWorkflow(inputs: any) {
  const owner = process.env.GH_OWNER!;
  const repo  = process.env.GH_REPO!;
  const token = process.env.GH_PAT!;
  const wfId  = normalizeWorkflowId(process.env.WORKFLOW_ID);
  if (!owner || !repo || !token) {
    throw new Error('Missing GH_OWNER/GH_REPO/GH_PAT');
  }

  // ref 选择：优先 GH_BRANCH；否则读仓库默认分支
  const ref = (process.env.GH_BRANCH && process.env.GH_BRANCH.trim()) ||
              await getDefaultBranch(owner, repo, token);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };

  // 1) repository_dispatch（不依赖 workflow 文件名/ID）
  const r1 = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/dispatches`,
    { method: 'POST', headers, body: JSON.stringify({ event_type: 'generate-apk', client_payload: inputs }) }
  );

  // 2) workflows/dispatches（明确到具体 workflow）
  let r2: { ok: boolean; status: number; statusText: string; text: string } | null = null;
  if (wfId) {
    r2 = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wfId}/dispatches`,
      { method: 'POST', headers, body: JSON.stringify({ ref, inputs }) }
    );
  }

  // 判定：两个有一个 2xx/204 即认为成功（有的接口返回 204 无 body）
  const success = (r1.ok && r1.status < 300) || (!!r2 && r2.ok && r2.status < 300);

  if (!success) {
    throw Object.assign(
      new Error('GitHub dispatch failed'),
      { gh: { owner, repo, ref, wfId, primary: r1, secondary: r2 } }
    );
  }
  return { degraded: !(r2 && r2.ok), gh: { owner, repo, ref, wfId, primary: r1, secondary: r2 } };
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

    // —— 触发 CI ——（把 plan/orchestrator 做为 inputs 带过去）
    step = 'dispatch';
    const branch = `ndjc-run/${runId}`;
    const actionsInputs: Record<string, any> = {
      runId,
      branch,                        // 供 workflow 自己 checkout 目标分支
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
    const repo  = process.env.GH_REPO!;
    const wf    = normalizeWorkflowId(process.env.WORKFLOW_ID!);
    const actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${wf || ''}`;

    return NextResponse.json(
      {
        ok: true,
        runId,
        branch,
        actionsUrl: wf ? actionsUrl : `https://github.com/${owner}/${repo}/actions`,
        degraded: res.degraded,
        mode: (o as any)?.mode || 'A',
        contract: actionsInputs.contract,
        ghDebug: res.gh,         // ← 带回 GitHub 两次调用的状态，方便你在页面上直接看
      },
      { headers: CORS }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, runId, step, error: String(e?.message ?? e), gh: e?.gh || null },
      { status: 500, headers: CORS }
    );
  }
}
