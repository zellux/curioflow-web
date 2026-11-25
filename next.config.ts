import type { NextConfig } from "next";
import { maxPdfUploadBytes } from "./src/server/entitlement-limits";

const allowedDevOrigins = Array.from(new Set(
  (process.env.CURIOFLOW_ALLOWED_DEV_ORIGINS?.split(",") ?? [])
    .map((origin) => origin.trim())
    .filter(Boolean)
));

const nextConfig: NextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  experimental: { proxyClientMaxBodySize: maxPdfUploadBytes() + 1024 * 1024 },
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/fonts/:bundle/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable"
          }
        ]
      },
      {
        source: "/fonts/:sheet.css",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
