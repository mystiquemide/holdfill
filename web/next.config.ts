import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solana and Anchor SDKs rely on Node built-ins; load them with Node's require instead of
  // bundling them. @meteora-ag/dlmm stays bundled: its ESM build uses directory imports that
  // Node's ESM loader rejects.
  serverExternalPackages: ["@solana/web3.js", "@solana/spl-token", "@anchor-lang/core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
