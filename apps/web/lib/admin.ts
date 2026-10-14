import { NextResponse } from "next/server";
import { currentUserId } from "./auth";
import { db } from "./db";

export async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  // Existing QA credentials work only on the local development server.
  if (
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_ADMIN_USERNAME &&
    process.env.LOCAL_ADMIN_PASSWORD &&
    userId === process.env.LOCAL_ADMIN_USER_ID
  )
    return true;
  const result = await db().query<{ is_admin: boolean }>(
    "select is_admin from portfolio.members where user_id=$1",
    [userId],
  );
  return result.rows[0]?.is_admin === true;
}
export async function adminAccess() {
  const userId = await currentUserId();
  if (!userId)
    return {
      response: NextResponse.json(
        { message: "로그인이 필요합니다." },
        { status: 401 },
      ),
      userId: null,
    };
  if (!(await isAdmin(userId)))
    return {
      response: NextResponse.json(
        { message: "관리자만 접근할 수 있습니다." },
        { status: 403 },
      ),
      userId: null,
    };
  return { response: null, userId };
}
export function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return (
      ["http:", "https:"].includes(origin.protocol) && origin.host === host
    );
  } catch {
    return false;
  }
}
