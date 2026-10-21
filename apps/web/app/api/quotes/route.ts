import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import {
  stockQuotesConfigured,
  quoteStocks,
  stockDataStatus,
} from "../../../lib/stock-data";
import { listHoldings, setQuote } from "../../../lib/holdings-db";
import {
  listRules,
  listCryptoAssets,
  recordSnapshot,
  setRuleQuote,
} from "../../../lib/portfolio-db";
import { refreshStoredCryptoQuotes } from "../../../lib/bithumb";

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
  try {
    const [cryptoCodes, allHoldings, rules] = await Promise.all([
      listCryptoAssets(userId),
      listHoldings(userId),
      listRules(userId),
    ]);
    if (!stockQuotesConfigured() && !cryptoCodes.length)
      return NextResponse.json(
        {
          message:
            "조회할 시세가 없습니다. 주식 시세 API 설정이나 가상자산 보유 항목을 확인해 주세요.",
        },
        { status: 503 },
      );
    const holdings = allHoldings.filter(
      (row) =>
        (row.market === "KR" && /^[0-9A-Z]{6}$/.test(row.symbol)) ||
        (row.market === "US" && /^[A-Z.]{1,10}$/.test(row.symbol)),
    );
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
    if (
      stockQuotesConfigured() &&
      unique.length > stockDataStatus().maxSymbols
    ) {
      return NextResponse.json(
        {
          message: `종목은 한 번에 ${stockDataStatus().maxSymbols}개까지 조회할 수 있습니다`,
        },
        { status: 400 },
      );
    }

    const cryptoPromise = cryptoCodes.length
      ? refreshStoredCryptoQuotes(userId).catch(() => [
          { price: null, error: "빗썸 원화 시세를 가져오지 못했습니다." },
        ])
      : Promise.resolve([]);
    const stockQuotes = await Promise.all(
      (await quoteStocks(unique)).map(async (quote) => {
        if (quote.price === null || !quote.checkedAt) return quote;
        try {
          await Promise.all([
            setQuote(
              userId,
              quote.market,
              quote.symbol,
              quote.exchange,
              quote.price,
              quote.label,
              quote.checkedAt,
            ),
            setRuleQuote(
              userId,
              quote.market,
              quote.symbol,
              quote.price,
              quote.checkedAt,
            ),
          ]);
          return quote;
        } catch {
          return {
            ...quote,
            price: null,
            previousClose: null,
            checkedAt: null,
            error: `${quote.symbol} 시세를 저장하지 못했습니다.`,
          };
        }
      }),
    );
    const cryptoQuotes = await cryptoPromise;
    const quotes = [...stockQuotes, ...cryptoQuotes];
    await recordSnapshot(userId, undefined, false);
    return NextResponse.json({ quotes, holdings: await listHoldings(userId) });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "주식 시세 API 연결 실패",
      },
      { status: 502 },
    );
  }
}
