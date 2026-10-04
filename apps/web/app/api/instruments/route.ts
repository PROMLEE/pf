import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import { findInstruments } from "../../../lib/kis";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await currentUserId()))
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market");
  const query = searchParams.get("query")?.trim() ?? "";
  if ((market !== "KR" && market !== "US") || !query || query.length > 80)
    return NextResponse.json(
      { message: "종목 검색 조건을 확인해 주세요" },
      { status: 400 },
    );
  try {
    return NextResponse.json({
      instruments: await findInstruments(market, query),
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "종목 코드를 찾지 못했습니다",
      },
      { status: 502 },
    );
  }
}
