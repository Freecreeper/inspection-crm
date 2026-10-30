import type { NextConfig } from "next";
import { HSTS_HEADER, SECURITY_HEADERS, TOKEN_PAGE_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Don't advertise the framework.
  poweredByHeader: false,
  // The app never uses next/image; turning the optimizer off removes an
  // unauthenticated endpoint (and the image-optimizer advisory class).
  images: { unoptimized: true },
  // Server actions default to a 1MB body — too small for document/photo
  // uploads (§ "Photo / Media Management"). 10MB is a placeholder ceiling;
  // revisit once real inspection photos are in play.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Browsers and bookmark tools that ask for /favicon.ico directly get the
  // company icon (Settings → Branding) the pages link to.
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/brand/icon", permanent: false }];
  },
  // The Content-Security-Policy (with a per-request nonce) is set in
  // src/proxy.ts; these are the static ones.
  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS, ...(production ? [HSTS_HEADER] : [])] },
      { source: "/r/:path*", headers: TOKEN_PAGE_HEADERS },
      { source: "/u/:path*", headers: TOKEN_PAGE_HEADERS },
      { source: "/a/:path*", headers: TOKEN_PAGE_HEADERS },
      { source: "/reset-password/:path*", headers: TOKEN_PAGE_HEADERS },
    ];
  },
};

export default nextConfig;
