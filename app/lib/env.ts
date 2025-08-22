// lib/env.ts
export function getEnv() {
  // 前端可见
  const PUBLIC_API_BASE =
    process.env.NEXT_PUBLIC_API_BASE ||
    process.env.API_BASE ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    '';

  // 服务端密钥，支持多种命名，谁有用谁
  const SERVER_SECRET =
    process.env.API_SECRET ||
    process.env.X_API_SECRET ||
    process.env.NEXT_PUBLIC_API_SECRET || // 兼容老代码/紧急场景
    '';

  // 仅给前端读取，用来塞到 header
  const PUBLIC_SECRET = process.env.NEXT_PUBLIC_API_SECRET || '';

  return {
    PUBLIC_API_BASE,
    SERVER_SECRET,
    PUBLIC_SECRET,
    GH_OWNER: process.env.GH_OWNER || '',
    GH_REPO: process.env.GH_REPO || '',
    GH_PAT: process.env.GH_PAT || '',
  };
}

export const ENV = getEnv();
