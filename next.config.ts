import type { NextConfig } from "next";

/** Prevent Vercel edge/CDN from serving stale join-page or invite API responses. */
const noStoreCacheHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, no-cache, must-revalidate",
  },
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Vercel-CDN-Cache-Control", value: "no-store" },
  { key: "Pragma", value: "no-cache" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/leagues/join/:token",
        headers: noStoreCacheHeaders,
      },
      {
        source: "/api/leagues/join/:token",
        headers: noStoreCacheHeaders,
      },
    ];
  },
};

export default nextConfig;
