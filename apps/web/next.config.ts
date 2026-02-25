import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/rootfetch/artifacts/runs/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/rootfetch/artifacts/replay/index.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=60, stale-while-revalidate=600",
          },
        ],
      },
      {
        source: "/rootfetch/artifacts/latest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=10, stale-while-revalidate=60",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
