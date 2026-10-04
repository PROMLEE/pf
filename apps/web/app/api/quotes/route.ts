import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import { kisConfigured, quoteKis } from "../../../lib/kis";
import { listHoldings, setQuote } from "../../../lib/holdings-db";
import {
  listRules,
  recordSnapshot,
  setRuleQuote,
} from "../../../lib/portfolio-db";

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
  if (!userId) {
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  }
  if (!sameOrigin(request)) {
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  }
  if (!kisConfigured()) {
    return NextResponse.json(
      {
        message:
          "한국투자증권 API 설정이 필요합니다. apps/web/.env.local을 확인하세요.",
      },
      { status: 503 },
    );
  }

  try {
    const holdings = (await listHoldings(userId)).filter(
      (row) =>
        (row.market === "KR" && /^[0-9A-Z]{6}$/.test(row.symbol)) ||
        (row.market === "US" && /^[A-Z.]{1,10}$/.test(row.symbol)),
    );
    const rules = await listRules(userId);
    const unique = Array.from(
      new Map(
        [
          ...holdings.map((row) => ({
            market: row.market,
            symbol: row.symbol,
            exchange: row.exchange ?? null,
          })),
          ...rules.map((row) => ({
            market: row.market,
            symbol: row.symbol,
            exchange: row.exchange_code,
          })),
        ].map((row) => [
          `${row.market}:${row.symbol}:${row.exchange ?? ""}`,
          row,
        ]),
      ).values(),
    );
    if (unique.length > 30) {
      return NextResponse.json(
        { message: "종목은 한 번에 30개까지 조회할 수 있습니다" },
        { status: 400 },
      );
    }

    const quotes = [];
    for (const row of unique) {
      const quote = await quoteKis(
        row.market,
        row.symbol,
        row.exchange ?? null,
      );
      quotes.push(quote);
      if (quote.price !== null && quote.checkedAt) {
        await setQuote(
          userId,
          row.market,
          row.symbol,
          row.exchange ?? null,
          quote.price,
          quote.label,
          quote.checkedAt,
        );
        await setRuleQuote(
          userId,
          row.market,
          row.symbol,
          quote.price,
          quote.checkedAt,
        );
      }
    }
    await recordSnapshot(userId);
    return NextResponse.json({ quotes, holdings: await listHoldings(userId) });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "한국투자증권 API 연결 실패",
      },
      { status: 502 },
    );
  }
}
