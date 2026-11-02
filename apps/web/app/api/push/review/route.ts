import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { sameOrigin } from "../../../../lib/admin";
import {
  getReview,
  saveReview,
  completeReview,
} from "../../../../lib/review-db";
import { reviewInput } from "../../../review-schedule";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    return NextResponse.json(
      { preferences: await getReview(user) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "점검 설정을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
export async function PATCH(request: Request) {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  let input;
  try {
    input = reviewInput(await request.json());
  } catch {}
  if (!input)
    return NextResponse.json(
      { message: "점검일과 알림 설정을 확인해 주세요." },
      { status: 400 },
    );
  try {
    return NextResponse.json({ preferences: await saveReview(user, input) });
  } catch {
    return NextResponse.json(
      { message: "점검 설정을 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  try {
    return NextResponse.json({ preferences: await completeReview(user) });
  } catch {
    return NextResponse.json(
      { message: "점검 완료를 기록하지 못했습니다." },
      { status: 500 },
    );
  }
}
