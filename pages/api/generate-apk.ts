// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from "next";

type TemplateName = "core-template" | "form-template" | "simple-template";

type PushFile = {
  path: string;
  content: string; // 纯文本 UTF-8；push-to-github 端会处理
};

type OkResp = {
  ok: true;
  template: TemplateName;
  appId: string;
  files: { path: string }[];
};

type ErrResp = {
  ok: false;
  error: string;
  details?: any;
};

/** 允许的模板 */
const ALLOWED_TEMPLATES: TemplateName[] = [
  "core-template",
  "form-template",
  "simple-template",
];

/** Git 信息（来自环境变量） */
const OWNER = process.env.OWNER || process.env.GITHUB_OWNER || "";
const REPO = process.env.REPO || process.env.GITHUB_REPO || "";
// 分支：main 或自定义（工作流里使用这个）
const REF = process.env.REF || "main";

/** 从请求头推导当前站点的绝对 Base URL（Vercel / 反代均可） */
function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.VERCEL ? "https" : "http");

  const hostHeader =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    process.env.VERCEL_URL || // 例如 niandongjicheng-xxxx.vercel.app（不含协议）
    "localhost:3000";

  // 如果环境里已经带协议，就直接返回；否则拼上协议
  const host = hostHeader.startsWith("http")
    ? hostHeader
    : `${proto}://${hostHeader}`;
  return host;
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

    // AppId 可固定（由模板/工作流决定），这里只做返回展示用
    const appId = "com.example.app";

    // 仅写入一个标记文件，工作流在构建时根据其内容拷贝 templates/<template>/ 到 app/
    const marker = [
      "__FROM_API__",
      `TEMPLATE: ${t}`,
      `PROMPT: ${prompt}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      "",
    ].join("\n");

    const files: PushFile[] = [
      {
        path: "app/src/main/assets/build_marker.txt",
        content: marker,
      },
    ];

    // 绝对 URL 访问本项目的 /api/push-to-github，避免 “Failed to parse URL…”
    const baseUrl = getBaseUrl(req);
    const pushUrl = new URL("/api/push-to-github", baseUrl).toString();

    const r = await fetch(pushUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 供 /api/push-to-github 做安全校验
        "x-api-secret": process.env.API_SECRET || "",
      },
      body: JSON.stringify({
        owner: OWNER,
        repo: REPO,
        ref: REF,
        message: `feat: generate from template ${t}`,
        files, // 推送的文件列表（后端负责写入）
      }),
    });

    // 若 push 失败，把后端返回的错误直接透传出来便于排查
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(500).json({
        ok: false,
        error: `push-to-github failed: ${r.status} ${r.statusText}`,
        details: text,
      });
    }

    return res.status(200).json({
      ok: true,
      template: t,
      appId,
      files: files.map((f) => ({ path: f.path })),
    });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Internal Server Error" });
  }
}
