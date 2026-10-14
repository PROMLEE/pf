import { NextResponse } from "next/server";
import { after } from "next/server";
import { dispatchPush, pushConfig } from "../../../../lib/push";
import { adminAccess, sameOrigin } from "../../../../lib/admin";
import { announcementInput } from "../../../../lib/announcements";
import { db } from "../../../../lib/db";
export const runtime = "nodejs";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
async function mutate(request: Request, edit: boolean) {
  try {
    const access = await adminAccess();
    if (access.response) return access.response;
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
        { message: "입력 내용을 확인해 주세요." },
        { status: 400 },
      );
    }
    const input = announcementInput(body);
    if (body?.sendPush !== undefined && typeof body.sendPush !== "boolean")
      return NextResponse.json(
        { message: "알림 발송 여부를 확인해 주세요." },
        { status: 400 },
      );
    if (
      body?.sendPush &&
      (input?.status !== "published" || !(await pushConfig()))
    )
      return NextResponse.json(
        {
          message:
            "알림은 서버 설정이 준비된 게시 공지에서만 요청할 수 있습니다.",
        },
        { status: 400 },
      );
    if (
      !input ||
      (edit &&
        (!uuid.test(body.id ?? "") ||
          !Number.isInteger(body.revision) ||
          body.revision < 1))
    )
      return NextResponse.json(
        { message: "제목·내용·게시 기간을 확인해 주세요." },
        { status: 400 },
      );
    const client = await db().connect();
    try {
      await client.query("begin");
      // Recheck under lock: revocation cannot race a write after the API check.
      const role = await client.query(
        "select is_admin from portfolio.members where user_id=$1 for share",
        [access.userId],
      );
      const localQA =
        process.env.NODE_ENV === "development" &&
        process.env.LOCAL_ADMIN_USERNAME &&
        process.env.LOCAL_ADMIN_PASSWORD &&
        access.userId === process.env.LOCAL_ADMIN_USER_ID;
      if (!localQA && role.rows[0]?.is_admin !== true) {
        await client.query("rollback");
        return NextResponse.json(
          { message: "관리자 권한이 해제되었습니다." },
          { status: 403 },
        );
      }
      const params = [
        input.title,
        input.body,
        input.status,
        input.important,
        input.startsAt,
        input.endsAt,
      ];
      const result = edit
        ? await client.query(
            `update portfolio.announcements set title=$1,body=$2,status=$3,important=$4,starts_at=$5,ends_at=$6,updated_at=now(),revision=revision+1 where id=$7 and revision=$8 returning *`,
            [...params, body.id, body.revision],
          )
        : await client.query(
            `insert into portfolio.announcements(title,body,status,important,starts_at,ends_at) values($1,$2,$3,$4,$5,$6) returning *`,
            params,
          );
      if (!result.rows[0]) {
        await client.query("rollback");
        return NextResponse.json(
          {
            message:
              "다른 곳에서 공지가 변경됐습니다. 목록을 갱신한 뒤 다시 수정해 주세요.",
          },
          { status: 409 },
        );
      }
      if (body.sendPush)
        await client.query(
          `insert into portfolio.push_campaigns(announcement_id) values($1) on conflict do nothing`,
          [result.rows[0].id],
        );
      await client.query(
        `insert into portfolio.admin_events(actor_id,action,announcement_id,details) values($1,$2,$3,$4::jsonb)`,
        [
          access.userId,
          edit ? "공지 수정" : "공지 작성",
          result.rows[0].id,
          JSON.stringify({
            title: input.title,
            status: input.status,
            revision: result.rows[0].revision,
            pushRequested: body.sendPush === true,
          }),
        ],
      );
      await client.query("commit");
      if (body.sendPush)
        after(async () => {
          try {
            await dispatchPush();
          } catch {
            console.error("Push dispatch deferred to scheduled retry");
          }
        });
      return NextResponse.json(
        { announcement: result.rows[0] },
        { status: edit ? 200 : 201 },
      );
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json(
      { message: "공지를 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
export const POST = (request: Request) => mutate(request, false);
export const PATCH = (request: Request) => mutate(request, true);
