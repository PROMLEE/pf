import { NextResponse } from "next/server";
import { currentUserId } from "../../../lib/auth";
import { kisConfigured, quoteKis } from "../../../lib/kis";
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
    if (!kisConfigured() && !cryptoCodes.length)
      return NextResponse.json(
        {
          message:
            "조회할 시세가 없습니다. KIS API 설정이나 가상자산 보유 항목을 확인해 주세요.",
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
    if (kisConfigured() && unique.length > 30) {
      return NextResponse.json(
        { message: "종목은 한 번에 30개까지 조회할 수 있습니다" },
        { status: 400 },
      );
    }

    const cryptoPromise = cryptoCodes.length
      ? refreshStoredCryptoQuotes(userId).catch(() => [
          { price: null, error: "빗썸 원화 시세를 가져오지 못했습니다." },
        ])
      : Promise.resolve([]);
    const stockQuotes = kisConfigured()
      ? await Promise.all(
          unique.map(async (row) => {
            try {
              const quote = await quoteKis(
                row.market,
                row.symbol,
                row.exchange ?? null,
              );
              if (quote.price !== null && quote.checkedAt) {
                await Promise.all([
                  setQuote(
                    userId,
                    row.market,
                    row.symbol,
                    row.exchange ?? null,
                    quote.price,
                    quote.label,
                    quote.checkedAt,
                  ),
                  setRuleQuote(
                    userId,
                    row.market,
                    row.symbol,
                    quote.price,
                    quote.checkedAt,
                  ),
                ]);
              }
              return quote;
            } catch {
              return {
                price: null,
                error: `${row.symbol} 시세를 가져오지 못했습니다.`,
              };
            }
          }),
        )
      : unique.length
        ? [
            {
              price: null,
              error: "주식 가격은 KIS API 설정 후 갱신할 수 있습니다.",
            },
          ]
        : [];
    const cryptoQuotes = await cryptoPromise;
    const quotes = [...stockQuotes, ...cryptoQuotes];
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
