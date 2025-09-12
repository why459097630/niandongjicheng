/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    // 若 groq.ts 里改为静态导入 `undici`，确保它不被打包
    serverComponentsExternalPackages: ['undici'],
  },
};

module.exports = nextConfig;
