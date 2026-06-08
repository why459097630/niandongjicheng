import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    "/api/download-pwa-package": ["./assets/fonts/*.ttf"],
    "/api/dev-preview-qr-poster": ["./assets/fonts/*.ttf"],
  },
};

export default nextConfig;
