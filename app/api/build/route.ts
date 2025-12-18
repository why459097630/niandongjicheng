import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BuildReq = {
  run_id?: string;
  appName?: string;
  uiPack?: string;
  modules?: string[];
  iconBase64?: string; // optional: data:image/png;base64,...
};

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

// 关键：补一个 GET，保证你在浏览器打开 /api/build 不会再 404
export async function GET() {
  return json({
    ok: true,
    route: "/api/build",
    methods: ["GET", "POST"],
    hint: "Use POST with { appName, uiPack, modules, iconBase64? }",
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BuildReq;

    const appName = (body.appName ?? "").trim();
    const uiPack = (body.uiPack ?? "").trim();
    const modules = Array.isArray(body.modules) ? body.modules : [];

    if (!appName) return json({ ok: false, error: "appName is required" }, { status: 400 });
    if (!uiPack) return json({ ok: false, error: "uiPack is required" }, { status: 400 });
    if (!modules.length) return json({ ok: false, error: "modules is required" }, { status: 400 });

    // run_id：前端可传；不传则这里生成一个
    const runId =
      (body.run_id ?? "").trim() ||
      `ndjc-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}-${Math.random()
        .toString(16)
        .slice(2, 8)}`;

    // 固定 template
    const assembly = {
      template: "core-skeleton",
      uiPack,
      modules,
      appName,
      // 后端 workflow 用的是 requests/<run_id>/icon.png -> materialize 到 lib/ndjc/icon.png
      iconPath: "lib/ndjc/icon.png",
    };

    // ====== 1) 写入 Packaging-warehouse: requests/<runId>/assembly.local.json (+ icon 可选) ======
    const GH_TOKEN = process.env.GH_TOKEN;
    const GH_OWNER = process.env.GH_OWNER;
    const GH_REPO = process.env.GH_REPO;
    const GH_BRANCH = process.env.GH_BRANCH || "main";
    const WORKFLOW_ID = process.env.WORKFLOW_ID || "android-build.yml";

    if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
      return json(
        {
          ok: false,
          error:
            "Missing env: GH_TOKEN / GH_OWNER / GH_REPO. (Vercel 上需要在 Project Settings -> Environment Variables 配置，.env.local 不会上传)",
        },
        { status: 500 }
      );
    }

    const apiBase = "https://api.github.com";
    const headers = {
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      Accept: "application/vnd.github+json",
    };

    async function upsertFile(path: string, contentUtf8: string, message: string) {
      const url = `${apiBase}/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}`;
      // 先取 sha（存在则更新，不存在则创建）
      const getRes = await fetch(url + `?ref=${encodeURIComponent(GH_BRANCH)}`, { headers });
      let sha: string | undefined = undefined;
      if (getRes.ok) {
        const j = await getRes.json();
        sha = j?.sha;
      }

      const putRes = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          branch: GH_BRANCH,
          sha,
          content: Buffer.from(contentUtf8, "utf8").toString("base64"),
        }),
      });

      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`GitHub contents PUT failed: ${putRes.status} ${t}`);
      }
      return putRes.json();
    }

    // assembly.local.json
    await upsertFile(
      `requests/${runId}/assembly.local.json`,
      JSON.stringify(assembly, null, 2),
      `ndjc: request ${runId} assembly.local.json`
    );

    // icon 可选：写 requests/<runId>/icon.png（base64 data url）
    const icon = body.iconBase64?.trim();
    if (icon) {
      const m = icon.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/);
      if (!m) {
        return json({ ok: false, error: "iconBase64 must be data:image/png;base64,... or jpeg" }, { status: 400 });
      }
      const base64 = m[2];
      // GitHub contents API 需要 base64(二进制)，这里直接传 base64 字符串即可
      const url = `${apiBase}/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(`requests/${runId}/icon.png`)}`;

      // sha
      const getRes = await fetch(url + `?ref=${encodeURIComponent(GH_BRANCH)}`, { headers });
      let sha: string | undefined = undefined;
      if (getRes.ok) {
        const j = await getRes.json();
        sha = j?.sha;
      }

      const putRes = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `ndjc: request ${runId} icon.png`,
          branch: GH_BRANCH,
          sha,
          content: base64,
        }),
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`GitHub icon PUT failed: ${putRes.status} ${t}`);
      }
    }

    // ====== 2) dispatch workflow：只传 run_id（你的 android-build.yml 也应只接 run_id） ======
    const dispatchUrl = `${apiBase}/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${encodeURIComponent(
      WORKFLOW_ID
    )}/dispatches`;

    const dispatchRes = await fetch(dispatchUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: GH_BRANCH,
        inputs: { run_id: runId },
      }),
    });

    if (!dispatchRes.ok) {
      const t = await dispatchRes.text();
      throw new Error(`Workflow dispatch failed: ${dispatchRes.status} ${t}`);
    }

    const actionsUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_ID}`;
    return json({ ok: true, runId, committed: true, actionsUrl });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
