// app/api/generate-apk/route.ts
// 瘦路由（Node.js）：编排 /（可选）Contract v1 校验 / 触发 GitHub Actions。
// 物化、注入模板、推送与打包均在 CI 内完成。

import { NextRequest, NextResponse } from 'next/server';
import { orchestrate } from '@/lib/ndjc/orchestrator';
import { randomBytes } from 'node:crypto';

// Contract v1 严格模式
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
function isDigits(s: string) {
  return /^\d+$/.test(s || '');
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

/* -------------- GitHub 调用（更健壮） -------------- */
async function ghFetch(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, statusText: r.statusText, text };
}

async function resolveWorkflowIdByName(owner: string, repo: string, token: string, nameOrFile: string) {
  // 已是数字/文件名直接返回
  if (isDigits(nameOrFile) || nameOrFile.endsWith('.yml') || nameOrFile.endsWith('.yaml')) return nameOrFile;

  // 以“显示名称”匹配，列表中找数字 ID
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  } as Record<string, string>;
  const r = await fetch(listUrl, { headers });
  if (!r.ok) return nameOrFile; // 查询失败则后续按原样尝试，并在失败时降级
  const j = await r.json().catch(() => null) as any;
  const items: any[] = Array.isArray(j?.workflows) ? j.workflows : [];
  const target = items.find(wf => String(wf.name || '').toLowerCase() === nameOrFile.toLowerCase());
  if (target?.id) return String(target.id);
  return nameOrFile;
}

async function dispatchWorkflow(inputs: any) {
  const owner = process.env.GH_OWNER!;
  const repo = process.env.GH_REPO!;
  const branch = process.env.GH_BRANCH || 'main'; // 必须是存放 yml 的分支
  const wfRaw = process.env.WORKFLOW_ID!;
  const token = process.env.GH_PAT!;
  if (!owner || !repo || !wfRaw || !token) {
    throw new Error('Missing GH_OWNER/GH_REPO/WORKFLOW_ID/GH_PAT');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
  };

  const resolved = await resolveWorkflowIdByName(owner, repo, token, wfRaw);
  const wfForPath = isDigits(resolved)
    ? resolved
    : (resolved.endsWith('.yml') || resolved.endsWith('.yaml')) ? resolved : `${resolved}.yml`;

  // 1) 优先试 workflows/dispatches
  const urlPrimary = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${wfForPath}/dispatches`;
  const primary = await ghFetch(urlPrimary, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: branch, inputs }),
  });

  // 2) 任何非 2xx → 降级到 repository_dispatch（不只 422）
  let secondary: any = null;
  let degraded = false;
  if (!primary.ok) {
    const url2 = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
    secondary = await ghFetch(url2, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event_type: 'generate-apk', client_payload: inputs }),
    });
    degraded = !!secondary?.ok;
  }

  return { degraded, primary, secondary, owner, repo, workflowId: wfForPath, branch };
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
      // 让 workflow 侧也能从 client_payload.ref 取到分支
      ref: branch,
    };

    if (process.env.NDJC_SKIP_ACTIONS === '1' || input?.skipActions === true) {
      return NextResponse.json(
        { ok: true, runId, branch, skipped: 'actions', actionsUrl: null, degraded: null, mode: (o as any)?.mode || 'A', contract: actionsInputs.contract },
        { headers: CORS }
      );
    }

    const res = await dispatchWorkflow(actionsInputs);
    const actionsUrl = `https://github.com/${res.owner}/${res.repo}/actions/workflows/${res.workflowId}`;

    if (!(res.degraded || res.primary.ok)) {
      // 两种方式都没成功，直接带调试信息返回
      return NextResponse.json(
        {
          ok: false, runId, branch, contract: actionsInputs.contract,
          error: 'Failed to dispatch GitHub Actions (both endpoints)',
          ghDebug: res,
        },
        { status: 502, headers: CORS }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        runId,
        branch,
        actionsUrl,
        degraded: res.degraded, // true 表示通过 repository_dispatch 降级触发
        mode: (o as any)?.mode || 'A',
        contract: actionsInputs.contract,
        ghDebug: {
          primary: { status: res.primary.status, text: res.primary.text },
          secondary: res.secondary ? { status: res.secondary.status, text: res.secondary.text } : null,
          owner: res.owner, repo: res.repo, workflowId: res.workflowId, branch: res.branch,
        },
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
