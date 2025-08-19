// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from "next";

type TemplateName = "core-template" | "form-template" | "simple-template";
type PushFile = { path: string; content: string };

type OkResp = { ok: true; template: TemplateName; appId: string; files: { path: string }[] };
type ErrResp = { ok: false; error: string; details?: any };

const ALLOWED_TEMPLATES: TemplateName[] = ["core-template", "form-template", "simple-template"];

// 仓库信息（在 Vercel 环境变量里配置）
const OWNER = process.env.OWNER || process.env.GITHUB_OWNER || "";
const REPO  = process.env.REPO  || process.env.GITHUB_REPO  || "";
const REF   = process.env.REF   || "main";

// 计算 API 根地址（兼容 Vercel / 本地）
function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.VERCEL ? "https" : "http");
  const hostHeader =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    process.env.VERCEL_URL ||
    "localhost:3000";
  return hostHeader.startsWith("http") ? hostHeader : `${proto}://${hostHeader}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkResp | ErrResp>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    if (!OWNER || !REPO) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing OWNER/REPO env variables" });
    }

    const { prompt, template } = (req.body || {}) as {
      prompt?: string;
      template?: string;
    };

    if (!prompt || typeof prompt !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "Missing or invalid 'prompt'" });
    }

    const t = (template || "").trim() as TemplateName;
    if (!ALLOWED_TEMPLATES.includes(t)) {
      return res.status(400).json({
        ok: false,
        error:
          "Invalid 'template'. Must be one of: core-template | form-template | simple-template",
      });
    }

    // 仅写入 marker，避免覆盖工程关键文件导致构建失败
    const appId = "com.example.app";
    const marker = [
      "__FROM_API__",
      `TEMPLATE: ${t}`,
      `PROMPT: ${prompt}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      "",
    ].join("\n");

    const files: PushFile[] = [
      { path: "app/src/main/assets/build_marker.txt", content: marker },
    ];

    const baseUrl = getBaseUrl(req);
    const pushUrl = new URL("/api/push-to-github", baseUrl).toString();

    // 同时把密钥放在 header 与 body，适配后端不同读取方式
    const secret =
      process.env.API_SECRET || process.env.NEXT_PUBLIC_API_SECRET || "";

    const r = await fetch(pushUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": secret, // Header 传
      },
      body: JSON.stringify({
        owner: OWNER,
        repo: REPO,
        ref: REF,
        message: `feat: generate from template ${t}`,
        files,
        apiSecret: secret, // Body 再传一份，防止后端只读 body
      }),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(500).json({
        ok: false,
        error: `push-to-github failed: ${r.status} ${r.statusText}`,
        details: text,
      });
    }

    return res
      .status(200)
      .json({ ok: true, template: t, appId, files: files.map((f) => ({ path: f.path })) });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Internal Server Error" });
  }
}
