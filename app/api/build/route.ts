// E:\NDJC\niandongjicheng\app\api\build\route.ts
import { NextResponse } from "next/server";

type BuildRequest = {
  runId?: string;
  appName?: string;
  templateKey?: string;
  uiPack?: string;
  modules?: string[]; // 逻辑模块列表
  // 可选：以后你要从前端传 iconBase64（dataURL 或纯 base64）也能直接接
  iconBase64?: string;
};

function corsHeaders() {
  const allowOrigin = process.env.ALLOW_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BuildRequest;

    const runId =
      body.runId ||
      `ndjc-${new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+/, "")}Z`;

    const owner = process.env.GH_OWNER; // why459097630
    const repo = process.env.GH_REPO; // Packaging-warehouse
    const token = process.env.GH_PAT || process.env.GH_TOKEN;
    const ref = process.env.GH_BRANCH || "main";

    // workflow 可以用 ID 或文件名（如 android-build.yml）
    const workflow = process.env.WORKFLOW_ID || "android-build.yml";

    if (!owner || !repo || !token) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing env: GH_OWNER / GH_REPO / GH_PAT(or GH_TOKEN). Check Vercel env and local .env.local.",
        },
        { status: 500, headers: corsHeaders() }
      );
    }

    // GitHub workflow_dispatch inputs 只能是 string
    const inputs: Record<string, string> = {
      run_id: runId,
      app_name: (body.appName || "NDJC App").slice(0, 40),
      template_key: body.templateKey || "shop-basic",
      ui_pack: body.uiPack || "",
      modules: Array.isArray(body.modules) ? body.modules.join(",") : "",
      icon_base64: body.iconBase64 ? String(body.iconBase64) : "",
    };

    const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
      workflow
    )}/dispatches`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref,
        inputs,
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `GitHub dispatch failed: HTTP ${r.status}`,
          detail: t,
        },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        runId,
        dispatched: true,
        repo: `${owner}/${repo}`,
        ref,
      },
      { status: 200, headers: corsHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500, headers: corsHeaders() }
    );
  }
}
