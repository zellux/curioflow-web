import type { NextConfig } from "next";

const allowedDevOrigins = Array.from(new Set([
  "192.168.3.30",
  ...(process.env.CURIOFLOW_ALLOWED_DEV_ORIGINS?.split(",") ?? [])
    .map((origin) => origin.trim())
    .filter(Boolean)
]));

const nextConfig: NextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  typedRoutes: true
};

export default nextConfig;
