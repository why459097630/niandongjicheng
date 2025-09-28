/** @type {import('next').NextConfig} */
const nextConfig = {
  // 仅服务器端函数需要；保持默认即可
  experimental: {
    // 排除掉会被误追踪进 Serverless 的大目录
    outputFileTracingExcludes: {
      '*': [
        // PNPM 全局/本地 store
        '.pnpm-store/**',
        'node_modules/.pnpm/**',
        // Next 的 webpack 缓存与产物
        '.next/webpack/**',
        '.next/cache/**',
        // 常见无用大文件
        '**/*.map',
      ],
    },
  },
};

module.exports = nextConfig;
