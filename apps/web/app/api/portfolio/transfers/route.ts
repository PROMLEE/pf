import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { sameOrigin } from "../../../../lib/admin";
import {
  applyCashTransfer,
  listCashTransfers,
} from "../../../../lib/cash-transfers-db";
import { CashTransferError, validCashTransfer } from "../../../cash-transfer";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUserId();
  if (!user)
    return NextResponse.json(
      { message: "로그인이 필요합니다." },
      { status: 401 },
    );
  try {
    return NextResponse.json({ transfers: await listCashTransfers(user) });
  } catch {
    return NextResponse.json(
      { message: "이체 기록을 불러오지 못했습니다." },
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
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json(
      { message: "이체 입력을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (!validCashTransfer(input))
    return NextResponse.json(
      { message: "출금·입금 자산과 금액을 확인해 주세요." },
      { status: 400 },
    );
  try {
    return NextResponse.json(await applyCashTransfer(user, input));
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof CashTransferError
            ? error.message
            : "이체를 반영하지 못했습니다. 같은 요청으로 재시도할 수 있습니다.",
      },
      { status: error instanceof CashTransferError ? error.status : 500 },
    );
  }
}
