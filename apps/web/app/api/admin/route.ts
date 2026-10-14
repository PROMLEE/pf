import { NextResponse } from "next/server";
import { adminAccess } from "../../../lib/admin";
import { db } from "../../../lib/db";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const access = await adminAccess();
    if (access.response) return access.response;
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    const page = Math.min(
      100000,
      Math.max(1, Number(url.searchParams.get("page")) || 1),
    );
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const [stats, users, count, announcements, events] = await Promise.all([
      db().query(
        `select count(*)::int as users, count(*) filter (where last_login_at >= now()-interval '30 days')::int as recent_logins, (select count(*)::int from portfolio.announcements where status='published' and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now())) as published from portfolio.members`,
      ),
      db().query(
        `select m.user_id, u.nickname, u."oauthProvider" as provider, m.joined_at, m.last_login_at, m.is_admin from portfolio.members m join public."User" u on u."userId"=m.user_id where u.nickname ilike $1 or m.user_id ilike $1 order by m.joined_at desc,m.user_id limit 30 offset $2`,
        [pattern, (Math.floor(page) - 1) * 30],
      ),
      db().query(
        `select count(*)::int as total from portfolio.members m join public."User" u on u."userId"=m.user_id where u.nickname ilike $1 or m.user_id ilike $1`,
        [pattern],
      ),
      db().query(
        `select a.*, (c.announcement_id is not null) as push_requested, (select count(*)::int from portfolio.push_deliveries d where d.announcement_id=a.id and d.state='sent') as push_sent, (select count(*)::int from portfolio.push_deliveries d where d.announcement_id=a.id and d.state='failed') as push_failed from portfolio.announcements a left join portfolio.push_campaigns c on c.announcement_id=a.id order by a.updated_at desc limit 100`,
      ),
      db().query(
        `select e.id::text, e.action, e.details, e.created_at, coalesce(u.nickname,'관리자') as actor from portfolio.admin_events e left join public."User" u on u."userId"=e.actor_id order by e.created_at desc,e.id desc limit 30`,
      ),
    ]);
    return NextResponse.json(
      {
        stats: stats.rows[0],
        users: users.rows,
        totalUsers: count.rows[0].total,
        page: Math.floor(page),
        announcements: announcements.rows,
        events: events.rows,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "운영 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
