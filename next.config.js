/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // 👉 不要排除 node_modules/.pnpm/**，否则 Next 跟踪时会把依赖裁掉
    // 仅在确实需要时才排除项目外部的 pnpm store（一般不需要）
    outputFileTracingExcludes: {
      "**/*": [
        // "../../.pnpm-store/**" // 如非必要可不加
      ]
    },

    // 👉 显式包含 styled-jsx 的 package.json，防止被裁剪
    outputFileTracingIncludes: {
      // 作用于所有路由（含 /api/generate-apk）
      "**/*": ["node_modules/styled-jsx/package.json"]
    }
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // 让 styled-jsx 作为运行时依赖（不被内联进 bundle），
      // 配合上面的 includes，它会被放进函数包的 node_modules 里。
      config.externals = config.externals || [];
      config.externals.push("styled-jsx");
    }
    return config;
  }
};

module.exports = nextConfig;
