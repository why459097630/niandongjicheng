// lib/env.ts
/**
 * 仅在服务端使用的环境变量（不会被打进客户端）
 */
export const serverEnv = {
  GH_OWNER: process.env.GH_OWNER ?? '',
  GH_REPO: process.env.GH_REPO ?? '',
  GH_PAT: process.env.GH_PAT ?? '',
  API_SECRET:
    process.env.API_SECRET ??
    process.env.X_API_SECRET ??
    process.env.NEXT_PUBLIC_API_SECRET ??
    '',
};

/**
 * 客户端可访问的环境变量（名字必须以 NEXT_PUBLIC_ 开头）
 */
export const clientEnv = {
  NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? '',
  NEXT_PUBLIC_API_SECRET: process.env.NEXT_PUBLIC_API_SECRET ?? '',
};
