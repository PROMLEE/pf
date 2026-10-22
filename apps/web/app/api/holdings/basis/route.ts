import { assertMeritzEditable } from "../../../../lib/meritz-readonly";
import { CashTransferError } from "../../../cash-transfer";
import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { listHoldings } from "../../../../lib/holdings-db";
import { validBasis } from "../../../fx-gains";
export const runtime = "nodejs";
export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host"))
      return NextResponse.json(
        { message: "허용되지 않은 요청입니다." },
        { status: 403 },
      );
  } catch {
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다." },
      { status: 403 },
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "원가 입력을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (
    !body ||
    typeof body.id !== "string" ||
    typeof body.revision !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.id ?? "") ||
    !/^\d{1,20}$/.test(body.revision ?? "") ||
    (body.averageCostKrw !== null && !validBasis(body.averageCostKrw))
  )
    return NextResponse.json(
      { message: "원화 주당 평균 매입단가를 확인해 주세요." },
      { status: 400 },
    );
  const client = await db().connect();
  try {
    await client.query("begin");
    await assertMeritzEditable(client, userId, { holdingId: body.id });
    const updated = await client.query(
      `update portfolio.holdings set average_cost_krw=$3, updated_at=now() where user_id=$1 and id=$2 and market='US' and position_revision::text=$4 returning id`,
      [userId, body.id, body.averageCostKrw, body.revision],
    );
    if (updated.rowCount !== 1) {
      await client.query("rollback");
      return NextResponse.json(
        {
          message:
            "보유 정보가 변경되었거나 미국 주식이 아닙니다. 수정 화면을 다시 열어 주세요.",
        },
        { status: 409 },
      );
    }
    const holdings = await listHoldings(userId, client);
    await client.query("commit");
    return NextResponse.json({ holdings });
  } catch (error) {
    await client.query("rollback");
    if(error instanceof CashTransferError) return NextResponse.json({message:error.message},{status:error.status});
    return NextResponse.json(
      { message: "원화 원가를 저장하지 못했습니다." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
