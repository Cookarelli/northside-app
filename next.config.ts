import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "zxing-wasm"],
  outputFileTracingIncludes: {
    "/api/show-qr/*": ["./public/vendor/zxing-wasm/3.1.4/zxing_writer.wasm"],
    "/api/private/store": [
      "./public/vendor/zxing-wasm/3.1.4/zxing_writer.wasm",
    ],
  },
  devIndicators: false,
  logging: { incomingRequests: false },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};
export default config;
