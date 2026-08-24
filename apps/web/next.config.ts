import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared contracts live outside this app as raw TypeScript, so Next has to
  // compile them rather than expecting a pre-built package.
  transpilePackages: ["@agentmandi/shared-types"],
};

export default nextConfig;
