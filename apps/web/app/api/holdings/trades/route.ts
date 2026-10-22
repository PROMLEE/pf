import { CashTransferError } from "../../../cash-transfer";
import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { applyHoldingTrade } from "../../../../lib/holding-trades-db";
import {
  PositionTradeError,
  validateHoldingTrade,
} from "../../../position-trade";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  const origin = request.headers.get("origin");
  try {
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "거래 입력을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object")
    return NextResponse.json(
      { message: "거래 입력을 확인해 주세요." },
      { status: 400 },
    );
  const { id, trade } = body as { id?: string; trade?: unknown };
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
    !validateHoldingTrade(trade)
  )
    return NextResponse.json(
      { message: "종목·거래 수량·단가를 확인해 주세요." },
      { status: 400 },
    );
  try {
    return NextResponse.json(await applyHoldingTrade(userId, id, trade));
  } catch (error) {
    return NextResponse.json(
      {
        message:
          (error instanceof PositionTradeError || error instanceof CashTransferError)
            ? error.message
            : "거래를 반영하지 못했습니다.",
      },
      { status: (error instanceof PositionTradeError || error instanceof CashTransferError) ? error.status : 500 },
    );
  }
}
