import { NextResponse } from "next/server";
import { Octokit } from "octokit";

export async function GET() {
  const OWNER = process.env.GH_OWNER!;
  const REPO  = process.env.GH_REPO!;
  const TOKEN = process.env.GITHUB_TOKEN!;
  const BRANCH = process.env.GH_BRANCH || "main";

  try {
    const octo = new Octokit({ auth: TOKEN });

    // 1) 看得到仓库吗？
    const repo = await octo.request("GET /repos/{owner}/{repo}", { owner: OWNER, repo: REPO });

    // 2) 看得到分支吗？
    const ref = await octo.request("GET /repos/{owner}/{repo}/git/refs/heads/{branch}", {
      owner: OWNER, repo: REPO, branch: BRANCH
    });

    // 3) 能创建一个 blob 吗？（这一步就是你现在 404 的地方）
    const blob = await octo.request("POST /repos/{owner}/{repo}/git/blobs", {
      owner: OWNER, repo: REPO, content: "ndjc-diag", encoding: "utf-8"
    });

    return NextResponse.json({
      ok: true,
      repo: { full_name: (repo.data as any).full_name, private: (repo.data as any).private },
      ref: { sha: (ref.data as any).object.sha },
      blob: { sha: (blob.data as any).sha }
    });
  } catch (e: any) {
    console.error("NDJC diag-github error:", e?.status, e?.message, e?.response?.data);
    return NextResponse.json({ ok: false, status: e?.status, error: e?.message, data: e?.response?.data }, { status: 500 });
  }
}
