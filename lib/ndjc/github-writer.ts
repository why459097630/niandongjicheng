// lib/ndjc/github-writer.ts
import { Octokit } from "octokit";

const OWNER = process.env.GH_OWNER!;
const REPO  = process.env.GH_REPO!;
const BRANCH = process.env.GH_BRANCH || "main";
const TOKEN = process.env.GH_TOKEN || process.env.GH_PAT;

if (!TOKEN) {
  console.error("[NDJC] GH token missing. Set GH_TOKEN or GH_PAT");
}

const octo = new Octokit({ auth: TOKEN });

async function ensureFile(path: string): Promise<string | null> {
  try {
    const r = await octo.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner: OWNER, repo: REPO, path, ref: BRANCH,
    });
    const sha = (r.data as any)?.sha;
    return sha || null;
  } catch (e: any) {
    if (e.status === 404) return null;
    console.error("[NDJC] ensureFile error:", path, e);
    throw e;
  }
}

async function putFile(path: string, content: string, message: string) {
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");
  const sha = await ensureFile(path);
  try {
    const res = await octo.request("PUT /repos/{owner}/{repo}/contents/{path}", {
      owner: OWNER,
      repo: REPO,
      path,
      message,
      content: contentBase64,
      branch: BRANCH,
      sha: sha || undefined,
    });
    return res.status >= 200 && res.status < 300;
  } catch (e) {
    console.error("[NDJC] putFile error", { path, sha }, e);
    return false;
  }
}

// 提交差量补丁
export async function commitEdits(
  edits: Array<{ path: string; patch?: string; contentBase64?: string }>,
  message: string,
): Promise<boolean> {
  try {
    let okAll = true;
    for (const e of edits) {
      const { path, contentBase64, patch } = e;

      if (contentBase64) {
        // 直接替换
        const ok = await putFile(path, Buffer.from(contentBase64, "base64").toString("utf8"), message);
        if (!ok) okAll = false;
        continue;
      }

      // patch：简单覆盖（生产可改成真正的 patch 应用）
      if (patch) {
        const ok = await putFile(path, patch, message);
        if (!ok) okAll = false;
        continue;
      }

      console.warn("[NDJC] commitEdits skip empty file:", path);
    }
    return okAll;
  } catch (e) {
    console.error("[NDJC] commitEdits fatal", e);
    return false;
  }
}

// 写 requests/<id>.json 等
export async function touchRequestFile(id: string, data: any) {
  const dir = "requests";
  const path = `${dir}/${id}.${data?.kind || "json"}.json`;
  const ok = await putFile(path, JSON.stringify(data, null, 2), `NDJC: request ${id} ${data?.kind || ""}`.trim());
  if (!ok) throw new Error(`touchRequestFile failed: ${path}`);
  return true;
}

// 触发 repository_dispatch
export async function dispatchBuild(payload: any) {
  try {
    const res = await octo.request("POST /repos/{owner}/{repo}/dispatches", {
      owner: OWNER,
      repo: REPO,
      event_type: "generate-apk",
      client_payload: payload,
    });
    return res;
  } catch (e) {
    console.error("[NDJC] dispatchBuild error", e);
    throw e;
  }
}
