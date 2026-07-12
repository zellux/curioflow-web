import type { NextConfig } from "next";

const allowedDevOrigins = process.env.CURIOFLOW_ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  devIndicators: false,
  typedRoutes: true
};

export default nextConfig;
