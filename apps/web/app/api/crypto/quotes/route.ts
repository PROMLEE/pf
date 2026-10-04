import { NextResponse } from "next/server";
import { currentUserId } from "../../../../lib/auth";
import { listPortfolio, recordSnapshot } from "../../../../lib/portfolio-db";
import { refreshStoredCryptoQuotes } from "../../../../lib/upbit";

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
    const quotes = await refreshStoredCryptoQuotes(userId);
    if (quotes.some((quote) => quote.price !== null))
      await recordSnapshot(userId);
    return NextResponse.json({
      quotes,
      portfolio: await listPortfolio(userId),
    });
  } catch {
    return NextResponse.json(
      { message: "업비트 원화 시세를 갱신하지 못했습니다" },
      { status: 502 },
    );
  }
}
