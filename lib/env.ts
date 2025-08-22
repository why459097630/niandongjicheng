// /lib/env.ts
export type ServerEnv = {
  GH_OWNER?: string;
  GH_REPO?: string;
  GH_PAT?: string;
  GH_BRANCH?: string;
  API_SECRET?: string;
  X_API_SECRET?: string;
  NEXT_PUBLIC_API_SECRET?: string; // 给前端用来随请求带上
  NEXT_PUBLIC_API_BASE?: string;   // 前端调 API 的基址
};

export const serverEnv: Required<Pick<
  ServerEnv,
  'GH_OWNER' | 'GH_REPO' | 'GH_PAT'
>> & Partial<ServerEnv> = {
  GH_OWNER: process.env.GH_OWNER ?? '',
  GH_REPO: process.env.GH_REPO ?? '',
  GH_PAT: process.env.GH_PAT ?? '',
  GH_BRANCH: process.env.GH_BRANCH ?? 'main',
  API_SECRET: process.env.API_SECRET,
  X_API_SECRET: process.env.X_API_SECRET, // 可选备用头
  NEXT_PUBLIC_API_SECRET: process.env.NEXT_PUBLIC_API_SECRET,
  NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE,
};

// 默认导出，API 里直接 import env from '@/lib/env'
export default serverEnv;
