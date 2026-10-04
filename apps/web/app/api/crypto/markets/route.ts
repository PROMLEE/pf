import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { listKrwCryptoMarkets } from "../../../../lib/bithumb";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await currentUserId()))
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
  if (!query || query.length > 80)
    return NextResponse.json(
      { message: "가상자산명이나 코드를 입력해 주세요" },
      { status: 400 },
    );
  try {
    const needle = query.toLocaleLowerCase("ko-KR");
    const markets = (await listKrwCryptoMarkets())
      .filter((market) =>
        `${market.marketCode} ${market.name} ${market.englishName}`
          .toLocaleLowerCase("ko-KR")
          .includes(needle),
      )
      .slice(0, 20);
    return NextResponse.json({ markets });
  } catch {
    return NextResponse.json(
      { message: "빗썸 원화마켓 목록을 불러오지 못했습니다" },
      { status: 502 },
    );
  }
}
