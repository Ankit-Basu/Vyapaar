import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared contracts live outside this app as raw TypeScript, so Next has to
  // compile them rather than expecting a pre-built package.
  transpilePackages: ["@vyapaar/shared-types"],

  // The dev route indicator floats over the bottom-left corner, which is where
  // the control room's rail already is. Hiding it does not suppress compile or
  // runtime errors, which still surface as usual.
  devIndicators: false,
};

export default nextConfig;
