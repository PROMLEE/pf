import { NextResponse } from "next/server";
import type { Holding } from "../../holdings";
import { currentUserId } from "../../../lib/auth";
import {
  addHoldings,
  listHoldings,
  removeHolding,
  updateHoldingAmounts,
  updateHoldingInstrument,
  updateHoldingAssignment,
} from "../../../lib/holdings-db";

export const runtime = "nodejs";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function valid(row: Holding) {
  return (
    row !== null &&
    typeof row === "object" &&
    typeof row.broker === "string" &&
    row.broker.trim().length > 0 &&
    row.broker.length <= 80 &&
    typeof row.account === "string" &&
    row.account.trim().length > 0 &&
    row.account.length <= 120 &&
    (row.market === "KR" || row.market === "US") &&
    typeof row.name === "string" &&
    row.name.trim().length > 0 &&
    row.name.length <= 200 &&
    typeof row.symbol === "string" &&
    (row.market === "KR"
      ? row.symbol === "" || /^[0-9A-Z]{6}$/.test(row.symbol)
      : /^[A-Z.]{1,10}$/.test(row.symbol)) &&
    (row.exchange == null ||
      (row.market === "KR"
        ? row.exchange === "KOSPI" || row.exchange === "KOSDAQ"
        : ["NAS", "NYS", "AMS"].includes(row.exchange))) &&
    typeof row.quantity === "number" &&
    Number.isFinite(row.quantity) &&
    row.quantity > 0 &&
    row.quantity < 1e12 &&
    (row.capturedPrice === null ||
      (typeof row.capturedPrice === "number" &&
        Number.isFinite(row.capturedPrice) &&
        row.capturedPrice > 0 &&
        row.capturedPrice < 1e12)) &&
    (row.averageCost == null ||
      (typeof row.averageCost === "number" &&
        Number.isFinite(row.averageCost) &&
        row.averageCost > 0 &&
        row.averageCost < 1e12)) &&
    typeof row.capturedAt === "string" &&
    Number.isFinite(Date.parse(row.capturedAt))
  );
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  try {
    return NextResponse.json({ holdings: await listHoldings(userId) });
  } catch {
    return NextResponse.json(
      { message: "자산을 불러오지 못했습니다" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  try {
    const data = (await request.json()) as { holdings?: Holding[] };
    if (
      !Array.isArray(data.holdings) ||
      data.holdings.length < 1 ||
      data.holdings.length > 100 ||
      !data.holdings.every(valid)
    ) {
      return NextResponse.json(
        { message: "종목 데이터를 확인해 주세요" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      holdings: await addHoldings(userId, data.holdings),
    });
  } catch {
    return NextResponse.json(
      { message: "종목을 저장하지 못했습니다" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  try {
    const data = (await request.json()) as { id?: string };
    if (!data.id || !/^[0-9a-f-]{36}$/i.test(data.id))
      return NextResponse.json(
        { message: "잘못된 종목 ID입니다" },
        { status: 400 },
      );
    return NextResponse.json({
      holdings: await removeHolding(userId, data.id),
    });
  } catch {
    return NextResponse.json(
      { message: "종목을 삭제하지 못했습니다" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  try {
    const body = (await request.json()) as {
      id?: string;
      bucketId?: string | null;
      assignmentSource?: "auto" | "manual";
      quantity?: number;
      averageCost?: number | null;
      market?: "KR" | "US";
      name?: string;
      symbol?: string;
      exchange?: string | null;
    };
    if (body.assignmentSource !== undefined) {
      const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      if (!body.id || !uuid.test(body.id) || !["auto", "manual"].includes(body.assignmentSource) ||
          (body.bucketId !== null && (typeof body.bucketId !== "string" || !uuid.test(body.bucketId))) ||
          (body.assignmentSource === "auto" && body.bucketId !== null))
        return NextResponse.json({message:"종목과 포트 배정을 확인해 주세요"},{status:400});
      const result = await updateHoldingAssignment(userId,body.id,body.bucketId ?? null,body.assignmentSource);
      if (!result) return NextResponse.json({message:"종목 또는 포트를 찾지 못했습니다"},{status:404});
      return NextResponse.json(result);
    }
    if (body.quantity !== undefined) {
      if (
        !body.id ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.id) ||
        typeof body.quantity !== "number" ||
        !Number.isFinite(body.quantity) ||
        body.quantity <= 0 ||
        body.quantity >= 1e12 ||
        Math.abs(body.quantity - Math.round(body.quantity * 1e6) / 1e6) >
          1e-9 ||
        body.averageCost === undefined ||
        (body.averageCost !== null &&
          (typeof body.averageCost !== "number" ||
            !Number.isFinite(body.averageCost) ||
            body.averageCost <= 0 ||
            body.averageCost >= 1e12))
      )
        return NextResponse.json(
          { message: "보유 수량과 매입단가를 확인해 주세요" },
          { status: 400 },
        );
      return NextResponse.json({
        holdings: await updateHoldingAmounts(
          userId,
          body.id,
          body.quantity,
          body.averageCost,
        ),
      });
    }
    if (
      !body.id ||
      !/^[0-9a-f-]{36}$/i.test(body.id) ||
      !body.name?.trim() ||
      body.name.length > 200 ||
      !body.symbol ||
      !(
        (body.market === "KR" &&
          /^[0-9A-Z]{6}$/.test(body.symbol) &&
          ["KOSPI", "KOSDAQ"].includes(body.exchange ?? "")) ||
        (body.market === "US" &&
          /^[A-Z.]{1,10}$/.test(body.symbol) &&
          ["NAS", "NYS", "AMS"].includes(body.exchange ?? ""))
      )
    ) {
      return NextResponse.json(
        { message: "종목 코드 정보를 확인해 주세요" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      holdings: await updateHoldingInstrument(userId, body.id, {
        name: body.name.trim(),
        symbol: body.symbol,
        exchange: body.exchange!,
        market: body.market!,
      }),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "수정할 자산을 찾지 못했습니다."
    )
      return NextResponse.json({ message: error.message }, { status: 404 });
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { message: "같은 계좌에 이미 등록된 종목 코드입니다" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { message: "자산 정보를 저장하지 못했습니다" },
      { status: 500 },
    );
  }
}
