import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "PortRhythm · 포트리듬",
    short_name: "PortRhythm",
    description:
      "투자는 나만의 리듬으로. 자산 비중과 리밸런싱을 함께 관리하세요.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#087b83",
    lang: "ko",
    icons: [
      {
        src: "/brand/portrhythm-logo-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/portrhythm-logo-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
