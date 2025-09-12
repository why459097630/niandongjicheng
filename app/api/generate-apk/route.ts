// app/api/generate-apk/route.ts
// 仅负责派发 GitHub Actions，不在 Vercel 本地写盘或跑 Gradle

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs'; // 确保使用 Node 运行时

/* ---------- 工具 ---------- */
function normalizeWorkflowId(wf: string) {
  if (/^\d+$/.test(wf)) return wf;      // 纯数字：workflow 数字 ID
  if (wf.endsWith('.yml')) return wf;   // 已是文件名
  return `${wf}.yml`;                   // 自动补 .yml
}

function ensureEnv(vars: string[]) {
  const miss = vars.filter((k) => !process.env[k]);
  if (miss.length) {
    throw new Error(`Missing env: ${miss.join(', ')}`);
  }
}

/** 触发 workflow；若 422（inputs 不匹配）则自动两级降级 */
async function dispatchWorkflow(payload: {
  owner: string;
  repo: string;
  branch: string;
  workflowId: string; // 文件名或数字ID
  token: string;      // GH_PAT / GH_TOKEN
  inputs?: Record<string, any>;
}) {
  const url = `https://api.github.com/repos/${payload.owner}/${payload.repo}/actions/workflows/${payload.workflowId}/dispatches`;
  const headers = {
    Authorization: `Bearer ${payload.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // 尝试：带完整 inputs
  const r1 = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ref: payload.branch, inputs: payload.inputs }),
  });
  if (r1.ok) return { ok: true, degraded: false };

  const text1 = await r1.text();
  if (r1.status === 422) {
    // 降级 1：只带 runId
    const r2 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: payload.branch, inputs: { runId: payload.inputs?.runId } }),
    });
    if (r2.ok) return { ok: true, degraded: true };

    // 降级 2：完全不带 inputs
    const r3 = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: payload.branch }),
    });
    if (r3.ok) return { ok: true, degraded: true };

    const text2 = await r2.text();
    const text3 = await r3.text();
    throw new Error(`GitHub 422: ${text1} :: ${text2} :: ${text3}`);
  }

  throw new Error(`GitHub ${r1.status} ${r1.statusText}: ${text1}`);
}

/* ---------- 路由 ---------- */
export async function POST(req: NextRequest) {
  let step = 'start';
  const runId = Date.now().toString();

  try {
    step = 'parse';
    const body = (await req.json().catch(() => ({}))) ?? {};
    const template = String(body.template || 'core-template');
    const appTitle = String(body.appTitle || body.appName || 'NDJC App');
    const packageName = String(body.packageName || body.packageId || 'com.ndjc.demo');

    step = 'env';
    // 你在 Vercel 上提供这些变量：GH_OWNER / GH_REPO / WORKFLOW_ID / GH_PAT / GH_BRANCH(可选, 默认 main)
    ensureEnv(['GH_OWNER', 'GH_REPO', 'WORKFLOW_ID', 'GH_PAT']);
    const owner = process.env.GH_OWNER!;
    const repo = process.env.GH_REPO!;
    const branch = process.env.GH_BRANCH || 'main';
    const token = process.env.GH_PAT!;
    const workflowId = normalizeWorkflowId(process.env.WORKFLOW_ID!);

    step = 'dispatch';
    const { ok, degraded } = await dispatchWorkflow({
      owner,
      repo,
      branch,
      workflowId,
      token,
      inputs: { runId, template, appTitle, packageName },
    });

    const actionsUrl = `https://github.com/${owner}/${repo}/actions/workflows/${workflowId}`;
    return NextResponse.json({ ok, runId, degraded, actionsUrl });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, step, runId, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
