import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: { proxyTimeout: 120000 },
  serverExternalPackages: ["pdf-parse", "mammoth", "exceljs"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
