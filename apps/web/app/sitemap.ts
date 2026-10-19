import type { MetadataRoute } from "next";
import { listPublicNotices } from "../lib/public-notices";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const notices = await listPublicNotices();
  return [
    { url: "https://pf.promleeblog.com/about" },
    { url: "https://pf.promleeblog.com/guide" },
    { url: "https://pf.promleeblog.com/notices" },
    ...notices.map((notice) => ({
      url: `https://pf.promleeblog.com/notices/${notice.id}`,
      lastModified: notice.updated_at,
    })),
  ];
}
