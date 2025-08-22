// pages/api/generate-apk.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { Octokit } from "@octokit/rest";

/**
 * 读取所需环境变量（尽量不要依赖路径别名，避免构建失败）
 */
const ENV = {
  GH_OWNER: process.env.GH_OWNER ?? "",
  GH_REPO: process.env.GH_REPO ?? "",
  GH_PAT: process.env.GH_PAT ?? "",
  GH_BRANCH: process.env.GH_BRANCH ?? "main",
  API_SECRET: process.env.API_SECRET ?? process.env.X_API_SECRET ?? "",
};

type ApiPayload = {
  prompt?: string;
  template?: string; // 'form-template' | 'core-template' | 'simple-template'
};

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  // 1) 基础校验：环境变量
  const missingEnv = Object.entries(ENV)
    .filter(([k, v]) => !v)
    .map(([k]) => k);
  if (missingEnv.length) {
    return res.status(500).json({
      ok: false,
      message: `Missing envs: ${missingEnv.join(", ")}`,
    });
  }

  // 2) 校验 API 密钥
  const incomingSecret =
    (req.headers["x-api-secret"] as string | undefined)?.trim() ||
    (req.headers["x_api_secret"] as string | undefined)?.trim();
  if (!incomingSecret || incomingSecret !== ENV.API_SECRET) {
    return res.status(401).json({ ok: false, message: "Unauthorized: bad API secret" });
  }

  // 3) 解析请求体
  const body: ApiPayload =
    typeof req.body === "string" ? safeJson<ApiPayload>(req.body) ?? {} : (req.body ?? {});
  const prompt = (body.prompt ?? "").toString().trim();
  const template = (body.template ?? "form-template").toString().trim();

  if (!prompt) {
    return res.status(400).json({ ok: false, message: "prompt is required" });
  }

  const octokit = new Octokit({ auth: ENV.GH_PAT });

  try {
    // 4) 写入/覆盖 content_pack 内容（确保有真实提交，触发 push）
    const packPath = "content_pack/pack.json";
    const packData = {
      prompt,
      template,
      ts: new Date().toISOString(),
    };
    const commitMessage = `content-pack: update pack.json (${template})`;

    const sha = await getShaIfExists(octokit, ENV.GH_OWNER, ENV.GH_REPO, packPath, ENV.GH_BRANCH);

    const upsert = await octokit.repos.createOrUpdateFileContents({
      owner: ENV.GH_OWNER,
      repo: ENV.GH_REPO,
      path: packPath,
      message: commitMessage,
      content: Buffer.from(JSON.stringify(packData, null, 2), "utf8").toString("base64"),
      branch: ENV.GH_BRANCH,
      sha: sha ?? undefined,
    });

    const commitSha = upsert?.data?.commit?.sha ?? "";

    // 5) 显式触发 workflow_dispatch → android-build-matrix.yml
    await octokit.request(
      "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
      {
        owner: ENV.GH_OWNER,
        repo: ENV.GH_REPO,
        workflow_id: "android-build-matrix.yml",
        ref: ENV.GH_BRANCH,
        inputs: {
          reason: "triggered-from-api",
          commit: commitSha,
          template,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      message: "Pushed content pack & dispatched Android CI",
      commit: commitSha,
    });
  } catch (err: any) {
    const msg = extractError(err);
    return res.status(500).json({ ok: false, message: msg });
  }
}

/** 若文件存在，返回其 sha（用于覆盖提交）；不存在返回 null */
async function getShaIfExists(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if (!Array.isArray(data) && "sha" in data) {
      return data.sha as string;
    }
    return null;
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function extractError(e: any): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  if (e.toString) return e.toString();
  return "Unknown error";
}
