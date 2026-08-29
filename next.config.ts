import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output keeps the Docker/Railway image small; harmless elsewhere.
  output: "standalone",
};

export default nextConfig;
