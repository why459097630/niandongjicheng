// app/lib/env.ts

/**
 * 仅在服务端使用的私密变量（不会被打到客户端）
 */
export const serverEnv = {
  GH_OWNER: process.env.GH_OWNER ?? '',
  GH_REPO: process.env.GH_REPO ?? '',
  GH_PAT: process.env.GH_PAT ?? '',
  API_SECRET: process.env.API_SECRET ?? '',
  X_API_SECRET: process.env.X_API_SECRET ?? '',
  // 可选：若你想显式指定分支，没有就默认 main
  GH_BRANCH: process.env.GH_BRANCH ?? 'main',
};

/**
 * 客户端可读（必须以 NEXT_PUBLIC_ 开头）
 */
export const clientEnv = {
  NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? '',
  NEXT_PUBLIC_API_SECRET: process.env.NEXT_PUBLIC_API_SECRET ?? '',
};

/**
 * 为了兼容旧代码中 `import { ENV } from '@/lib/env'`
 * 直接把 serverEnv 重新导出为 ENV
 * 以及把 clientEnv 作为 PUBLIC_ENV 暴露
 */
export const ENV = serverEnv;
export const PUBLIC_ENV = clientEnv;
