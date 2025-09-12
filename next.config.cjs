// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 把要在运行时读取的文件夹强制打进 serverless 包
    outputFileTracingIncludes: {
      // App Router 的 API 路由
      'app/api/**': [
        'templates/**',
        'content_pack/**',
        'requests/**'
      ],
      // 如果你还用到了 Pages Router 的 API
      'pages/api/**': [
        'templates/**',
        'content_pack/**',
        'requests/**'
      ],
    },
  },
};

module.exports = nextConfig;
