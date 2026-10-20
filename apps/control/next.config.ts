import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  turbopack: { root: path.resolve(__dirname, "../..") },
  transpilePackages: [
    "@northside/data",
    "@northside/domain",
    "@northside/shopify",
    "@northside/agent-runtime",
  ],
  serverExternalPackages: ["postgres"],
  devIndicators: false,
};
export default config;
