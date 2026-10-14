import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import { sameOrigin } from "../../../lib/admin";
import { db } from "../../../lib/db";
import { pushConfig } from "../../../lib/push";
import { pushSubscriptionInput } from "../../../lib/push-validation";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    const config = await pushConfig();
    const result = await db().query(
      `select id,endpoint,enabled from portfolio.push_subscriptions where user_id=$1`,
      [user],
    );
    return NextResponse.json(
      {
        ready: !!config,
        publicKey: config?.publicKey ?? null,
        subscriptions: result.rows,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { message: "알림 설정을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
async function mutate(request: Request, remove: boolean) {
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
  try {
    if (remove) {
      if (typeof body?.endpoint !== "string" || body.endpoint.length > 2048)
        return NextResponse.json(
          { message: "알림 정보를 확인해 주세요." },
          { status: 400 },
        );
      await db().query(
        `update portfolio.push_subscriptions set enabled=false where user_id=$1 and endpoint=$2`,
        [user, body.endpoint],
      );
      return NextResponse.json({ saved: true });
    }
    const subscription = pushSubscriptionInput(body);
    if (!subscription)
      return NextResponse.json(
        { message: "지원하지 않는 알림 구독입니다." },
        { status: 400 },
      );
    if (!(await pushConfig()))
      return NextResponse.json(
        { message: "서버 알림 설정이 준비되지 않았습니다." },
        { status: 503 },
      );
    const client = await db().connect();
    let result;
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `pf-push:${user}`,
      ]);
      result = await client.query(
        `insert into portfolio.push_subscriptions(user_id,endpoint,p256dh,auth) select $1,$2,$3,$4 where (select count(*) from portfolio.push_subscriptions where user_id=$1 and enabled)<10 or exists(select 1 from portfolio.push_subscriptions where user_id=$1 and endpoint=$2 and enabled) on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,enabled=true where portfolio.push_subscriptions.user_id=excluded.user_id returning id`,
        [
          user,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth,
        ],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    if (!result.rows.length)
      return NextResponse.json(
        {
          message:
            "다른 계정의 알림이 연결되어 있거나 등록 가능한 기기 수를 초과했습니다. 이 브라우저의 기존 알림을 해제한 뒤 다시 연결해 주세요.",
        },
        { status: 409 },
      );
    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json(
      { message: "알림 설정을 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
