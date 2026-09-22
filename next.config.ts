import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server actions default to a 1MB body — too small for document/photo
  // uploads (§ "Photo / Media Management"). 10MB is a placeholder ceiling;
  // revisit once real inspection photos are in play.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
