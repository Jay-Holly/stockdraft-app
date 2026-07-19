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

/** Supabase Storage host for user-uploaded team logos (derived, not hardcoded). */
const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
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
