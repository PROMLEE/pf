import { cache } from "react";
import { db } from "./db";

export type PublicNoticeSummary = {
  id: string;
  title: string;
  important: boolean;
  created_at: Date;
  updated_at: Date;
};
export type PublicNotice = PublicNoticeSummary & { body: string };

// Public pages, detail metadata and sitemap must share the same visibility rules.
const visible = `status='published' and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now())`;

export const listPublicNotices = cache(
  async (): Promise<PublicNoticeSummary[]> => {
    const result = await db().query<PublicNoticeSummary>(
      `select id,title,important,created_at,updated_at from portfolio.announcements where ${visible} order by created_at desc,id desc`,
    );
    return result.rows;
  },
);

export const getPublicNotice = cache(
  async (id: string): Promise<PublicNotice | null> => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      return null;
    const result = await db().query<PublicNotice>(
      `select id,title,body,important,created_at,updated_at from portfolio.announcements where ${visible} and id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  },
);
