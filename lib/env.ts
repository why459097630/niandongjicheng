// 仅服务端可读（不会打进前端）
export const serverEnv = {
  GH_OWNER: process.env.GH_OWNER ?? '',
  GH_REPO: process.env.GH_REPO ?? '',
  GH_PAT: process.env.GH_PAT ?? '',
  API_SECRET: process.env.API_SECRET ?? '',
  X_API_SECRET: process.env.X_API_SECRET ?? '',
  GH_BRANCH: process.env.GH_BRANCH ?? 'main',
};

// 客户端可读（必须以 NEXT_PUBLIC_ 开头）
export const clientEnv = {
  NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? '',
  NEXT_PUBLIC_API_SECRET: process.env.NEXT_PUBLIC_API_SECRET ?? '',
};
