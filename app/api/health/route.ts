// app/api/health/route.ts
import { NextResponse } from 'next/server';
import { getRepoPath } from '@/lib/ndjc/journal';

// 用 Node 运行时（默认也可以）
export const runtime = 'nodejs';

export async function GET() {
  // 仅以布尔值回显敏感 env 是否存在，避免泄露内容
  const presence = {
    GH_OWNER: !!process.env.GH_OWNER,
    GH_REPO: !!process.env.GH_REPO,
    GH_BRANCH: !!process.env.GH_BRANCH,
    WORKFLOW_ID: !!process.env.WORKFLOW_ID,
    GH_PAT: !!process.env.GH_PAT,
    PACKAGING_REPO_PATH: !!process.env.PACKAGING_REPO_PATH,
    TEMPLATES_DIR: !!process.env.TEMPLATES_DIR,
    NDJC_API_PORT: !!process.env.NDJC_API_PORT,
  };

  // 非敏感项可以直接回显具体值，便于排查
  const values = {
    PACKAGING_REPO_PATH: process.env.PACKAGING_REPO_PATH ?? null,
    TEMPLATES_DIR: process.env.TEMPLATES_DIR ?? null,
    NDJC_API_PORT: process.env.NDJC_API_PORT ?? null,
  };

  return NextResponse.json({
    ok: true,
    repo: getRepoPath(),
    cwd: process.cwd(),
    env: { presence, values },
  });
}
