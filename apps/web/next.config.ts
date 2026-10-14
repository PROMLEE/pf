import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  async headers() {
    return [
      ...["/about", "/guide", "/llms-full.txt"].map(source => ({
        source,
        headers: [{ key: "Link", value: '</llms.txt>; rel="describedby"' }],
      })),
      ...["/llms.txt", "/llms-full.txt"].map(source => ({
        source,
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      })),
      {source: "/sw.js",headers:[{key:"Cache-Control",value:"no-cache"},{key:"Service-Worker-Allowed",value:"/"}]}, { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  }
};

export default nextConfig;
