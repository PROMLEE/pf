import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import {
  addCashFlow,
  deleteCashFlow,
  updateCashFlow,
  listPortfolio,
} from "../../../../lib/portfolio-db";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

async function saveFlow(request: Request, editing: boolean) {
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
      id?: unknown;
      date?: unknown;
      amountKrw?: unknown;
      note?: unknown;
    };
    if (
      (editing && (typeof body.id !== "string" || !uuid.test(body.id))) ||
      !validDate(body.date) ||
      typeof body.amountKrw !== "number" ||
      !Number.isFinite(body.amountKrw) ||
      body.amountKrw === 0 ||
      Math.abs(body.amountKrw) > 1e15 ||
      Math.round(body.amountKrw * 100) !== body.amountKrw * 100 ||
      typeof body.note !== "string" ||
      body.note.length > 120
    ) {
      return NextResponse.json(
        { message: "입출금 날짜·금액·메모를 확인해 주세요" },
        { status: 400 },
      );
    }
    if (!(await listPortfolio(userId)))
      return NextResponse.json(
        { message: "포트폴리오를 먼저 저장해 주세요" },
        { status: 400 },
      );
    const portfolio = await (editing ? updateCashFlow : addCashFlow)(userId, {
      id: editing ? body.id as string : crypto.randomUUID(),
      date: body.date,
      amountKrw: body.amountKrw,
      note: body.note.trim(),
    });
    if (!portfolio) return NextResponse.json({ message: "내역을 찾지 못했습니다" }, { status: 404 });
    return NextResponse.json({ portfolio });
  } catch {
    return NextResponse.json(
      { message: "입출금 내역을 저장하지 못했습니다" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) { return saveFlow(request, false); }
export async function PUT(request: Request) { return saveFlow(request, true); }

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
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !uuid.test(id))
    return NextResponse.json(
      { message: "내역 ID를 확인해 주세요" },
      { status: 400 },
    );
  try {
    if (!(await deleteCashFlow(userId, id)))
      return NextResponse.json(
        { message: "내역을 찾지 못했습니다" },
        { status: 404 },
      );
    return NextResponse.json({ portfolio: await listPortfolio(userId) });
  } catch {
    return NextResponse.json(
      { message: "입출금 내역을 삭제하지 못했습니다" },
      { status: 500 },
    );
  }
}
