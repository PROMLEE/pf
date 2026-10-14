import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import { isAdmin } from "../../../lib/admin";
import { db } from "../../../lib/db";
export const runtime = "nodejs";
export async function GET() {
  try {
    const user = await currentUserId();
    if (!user)
      return NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 },
      );
    const [result, admin] = await Promise.all([
      db().query(
        `select id,title,body,important,created_at from portfolio.announcements where status='published' and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>now()) order by important desc,created_at desc limit 50`,
      ),
      isAdmin(user),
    ]);
    return NextResponse.json(
      { announcements: result.rows, isAdmin: admin },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "공지를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
