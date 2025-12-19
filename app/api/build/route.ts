export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, route: "/api/build" });
}

export async function POST(req: Request) {
  return Response.json({ ok: true });
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BuildReq = {
  run_id?: string;
  uiPack?: string;          // assembly.local.json: uiPack
  modules?: string[];       // assembly.local.json: modules
  appName?: string;         // assembly.local.json: appName
  iconBase64?: string;      // optional dataURL: data:image/png;base64,...
};

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw Object.assign(new Error(`Missing env: ${name}`), { status: 500 });
  return v;
}

async function ghFetch(url: string, init: { token: string } & RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${init.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    throw Object.assign(new Error(data?.message || `GitHub HTTP ${res.status}`), {
      status: res.status,
      detail: data,
    });
  }
  return data;
}

function parseDataUrlToBytes(dataUrl: string) {
  const m = /^data:(.+?);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw Object.assign(new Error("iconBase64 must be a dataURL: data:*/*;base64,..."), { status: 400 });
  const b64 = m[2];
  const buf = Buffer.from(b64, "base64");
  return buf;
}

async function upsertFile(params: {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  contentBytes: Buffer;
  message: string;
  token: string;
}) {
  const { owner, repo, branch, path, contentBytes, message, token } = params;
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  // get sha if exists
  let sha: string | undefined;
  try {
    const existing = await ghFetch(`${api}?ref=${encodeURIComponent(branch)}`, { token, method: "GET" });
    sha = existing?.sha;
  } catch (_) {
    sha = undefined;
  }

  const body: any = {
    message,
    branch,
    content: contentBytes.toString("base64"),
  };
  if (sha) body.sha = sha;

  await ghFetch(api, {
    token,
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dispatchWorkflow(params: {
  owner: string;
  repo: string;
  workflowId: string;
  ref: string;
  inputs: Record<string, string>;
  token: string;
}) {
  const { owner, repo, workflowId, ref, inputs, token } = params;
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
  // 注意：inputs 只能包含 workflow_dispatch 里声明过的键；本方案只传 run_id
  await ghFetch(url, {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, inputs }),
  });
}

export async function POST(req: Request) {
  try {
    const GH_TOKEN = requireEnv("GH_TOKEN");
    const GH_OWNER = requireEnv("GH_OWNER");
    const GH_REPO = requireEnv("GH_REPO");
    const GH_BRANCH = requireEnv("GH_BRANCH");
    const WORKFLOW_ID = requireEnv("WORKFLOW_ID");

    const body = (await req.json()) as BuildReq;

    const runId = body.run_id?.trim();
    const template = "core-skeleton";
    const uiPack = body.uiPack?.trim();
    const modules = Array.isArray(body.modules) ? body.modules : [];
    const appName = body.appName?.trim();

    if (!runId) return json({ ok: false, error: "run_id is required" }, { status: 400 });
    if (!uiPack) return json({ ok: false, error: "uiPack is required" }, { status: 400 });
    if (!appName) return json({ ok: false, error: "appName is required" }, { status: 400 });
    if (!modules.length) return json({ ok: false, error: "modules is required" }, { status: 400 });

    // 1) 写 requests/<run_id>/assembly.local.json（以你截图的键名为准）
    const assemblyPath = `requests/${runId}/assembly.local.json`;
    const iconReqPath = `requests/${runId}/icon.png`;

    const assembly = {
      template,
      uiPack,
      modules,
      appName,
      iconPath: "lib/ndjc/icon.png", // 固定为后端读取路径；workflow 会把 requests/<run_id>/icon.png 拷过去
    };

    await upsertFile({
      owner: GH_OWNER,
      repo: GH_REPO,
      branch: GH_BRANCH,
      path: assemblyPath,
      contentBytes: Buffer.from(JSON.stringify(assembly, null, 2), "utf-8"),
      message: `ndjc: write ${assemblyPath}`,
      token: GH_TOKEN,
    });

    // 2) 有图标就写 requests/<run_id>/icon.png（给 workflow 拷贝）
    if (body.iconBase64) {
      const bytes = parseDataUrlToBytes(body.iconBase64);
      await upsertFile({
        owner: GH_OWNER,
        repo: GH_REPO,
        branch: GH_BRANCH,
        path: iconReqPath,
        contentBytes: bytes,
        message: `ndjc: write ${iconReqPath}`,
        token: GH_TOKEN,
      });
    }

    // 3) dispatch workflow：只传 run_id（android-build.yml 只声明了 run_id）
    await dispatchWorkflow({
      owner: GH_OWNER,
      repo: GH_REPO,
      workflowId: WORKFLOW_ID,
      ref: GH_BRANCH,
      inputs: { run_id: runId },
      token: GH_TOKEN,
    });

    const actionsUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}`;

    return json({ ok: true, runId, committed: true, actionsUrl });
  } catch (e: any) {
    return json(
      { ok: false, error: e?.message || String(e), status: e?.status, detail: e?.detail },
      { status: e?.status && Number.isInteger(e.status) ? e.status : 500 }
    );
  }
}
