import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://pf.promleeblog.com/about" },
    { url: "https://pf.promleeblog.com/guide" },
  ];
}
