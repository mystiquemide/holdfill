import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solana and Anchor SDKs rely on Node built-ins; load them with Node's require instead of
  // bundling them. @meteora-ag/dlmm stays bundled: its ESM build uses directory imports that
  // Node's ESM loader rejects.
  serverExternalPackages: ["@solana/web3.js", "@solana/spl-token", "@anchor-lang/core"],
};

export default nextConfig;
