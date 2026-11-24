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
  typedRoutes: true
};

export default nextConfig;
