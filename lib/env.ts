// lib/env.ts
export const clientEnv = {
  // 仅前端可读（必须以 NEXT_PUBLIC_ 开头）
  NEXT_PUBLIC_API_SECRET: process.env.NEXT_PUBLIC_API_SECRET ?? '',
  API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? process.env.API_BASE ?? '',
};

export const serverEnv = {
  GH_OWNER: process.env.GH_OWNER ?? '',
  GH_REPO: process.env.GH_REPO ?? '',
  GH_PAT: process.env.GH_PAT ?? '',
  SITE_URL: process.env.SITE_URL ?? '',
  X_API_SECRET: process.env.X_API_SECRET ?? '',
  API_SECRET: process.env.API_SECRET ?? '',
};
