import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { sameOrigin } from "../../../../lib/admin";
import { db } from "../../../../lib/db";
import { sendPush } from "../../../../lib/push";
export const runtime = "nodejs";
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
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "알림 정보를 확인해 주세요." },
      { status: 400 },
    );
  }
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 2048)
    return NextResponse.json(
      { message: "알림 정보를 확인해 주세요." },
      { status: 400 },
    );
  try {
    const result = await db().query<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>(
      `update portfolio.push_subscriptions set last_test_at=now() where user_id=$1 and endpoint=$2 and enabled and (last_test_at is null or last_test_at<now()-interval '1 minute') returning id,endpoint,p256dh,auth`,
      [user, body.endpoint],
    );
    const subscription = result.rows[0];
    if (!subscription)
      return NextResponse.json(
        { message: "알림을 먼저 켜거나 1분 뒤 다시 테스트해 주세요." },
        { status: 429 },
      );
    try {
      await sendPush(subscription, {
        title: "PortRhythm 알림 테스트",
        body: "공지 알림이 이 기기에 연결됐습니다.",
        url: "/?view=preferences",
        tag: "portrhythm-test",
      });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410)
        await db().query(
          `update portfolio.push_subscriptions set enabled=false where id=$1 and user_id=$2`,
          [subscription.id, user],
        );
      throw error;
    }
    return NextResponse.json({
      message: "테스트 알림을 발송했습니다. 기기의 알림 설정도 확인해 주세요.",
    });
  } catch {
    return NextResponse.json(
      { message: "알림을 발송하지 못했습니다. 알림을 껐다가 다시 켜 주세요." },
      { status: 502 },
    );
  }
}
