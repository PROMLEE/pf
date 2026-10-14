import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  async headers() {
    return [{source: "/sw.js",headers:[{key:"Cache-Control",value:"no-cache"},{key:"Service-Worker-Allowed",value:"/"}]}, { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  }
};

export default nextConfig;
