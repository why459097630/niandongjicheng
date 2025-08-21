// next.config.cjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 如果用了 app 目录，保留这行；没用可以删除
  experimental: { appDir: true }
};

module.exports = nextConfig;
