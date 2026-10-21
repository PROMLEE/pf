import { kisConfigured, quoteKis, findInstruments } from "./kis";
import { tossConfigured, quoteTossBatch, findTossInstruments } from "./toss";
import type { Market } from "../app/holdings";
import type { StockQuote, StockRequest } from "./market-data-types";
export type StockProvider = "kis" | "toss";
const key = (row: StockRequest) =>
  `${row.market}:${row.symbol}:${row.exchange ?? ""}`;
export function stockDataStatus() {
  const selected = process.env.STOCK_DATA_PROVIDER ?? "kis";
  if (selected !== "kis" && selected !== "toss")
    throw Error("STOCK_DATA_PROVIDER는 kis 또는 toss로 설정해 주세요.");
  const fallback = process.env.STOCK_DATA_FALLBACK !== "false";
  const available: StockProvider[] = [];
  if (kisConfigured()) available.push("kis");
  if (tossConfigured()) available.push("toss");
  const order: StockProvider[] = [
    selected,
    ...(fallback
      ? [selected === "kis" ? ("toss" as const) : ("kis" as const)]
      : []),
  ].filter((provider): provider is StockProvider =>
    available.includes(provider as StockProvider),
  );
  return {
    selected,
    primary: order[0] ?? null,
    fallback,
    available,
    order,
    maxSymbols: order[0] === "toss" ? 200 : 30,
  };
}
export function stockQuotesConfigured() {
  return stockDataStatus().order.length > 0;
}
async function quotesFrom(
  provider: StockProvider,
  rows: StockRequest[],
): Promise<StockQuote[]> {
  if (provider === "toss") return quoteTossBatch(rows);
  return Promise.all(
    rows.map((row) => quoteKis(row.market, row.symbol, row.exchange)),
  );
}
export async function quoteStocks(rows: StockRequest[]): Promise<StockQuote[]> {
  const { order, maxSymbols } = stockDataStatus();
  if (order.length && rows.length > maxSymbols)
    throw Error(`종목은 한 번에 ${maxSymbols}개까지 조회할 수 있습니다.`);
  const results = new Map<string, StockQuote>();
  for (const provider of order) {
    const remaining = rows
      .filter((row) => !results.get(key(row))?.price)
      .slice(0, provider === "kis" ? 30 : 200);
    if (!remaining.length) break;
    try {
      const quotes = await quotesFrom(provider, remaining);
      quotes.forEach((quote, index) =>
        results.set(key(remaining[index]), {
          ...quote,
          exchange: remaining[index].exchange,
        }),
      );
    } catch (error) {
      for (const row of remaining)
        results.set(key(row), {
          ...row,
          price: null,
          previousClose: null,
          currency: row.market === "KR" ? "KRW" : "USD",
          checkedAt: null,
          label: provider === "kis" ? "한국투자증권 현재가" : "토스증권 현재가",
          error:
            error instanceof Error
              ? error.message
              : "주식 시세를 조회하지 못했습니다.",
        });
    }
  }
  return rows.map(
    (row) =>
      results.get(key(row)) ?? {
        ...row,
        price: null,
        previousClose: null,
        currency: row.market === "KR" ? "KRW" : "USD",
        checkedAt: null,
        label: "주식 시세",
        error: order.length
          ? "보조 시세 조회 한도를 초과했습니다."
          : "주식 시세 API가 설정되지 않았습니다.",
      },
  );
}
export async function searchStocks(market: Market, query: string) {
  const { order } = stockDataStatus();
  // KIS master downloads do not require credentials; preserve public-master search.
  const providers = order.length ? order : ["kis" as const];
  let lastError: unknown;
  for (const provider of providers) {
    try {
      const rows = await (provider === "toss"
        ? findTossInstruments(market, query)
        : findInstruments(market, query));
      if (rows.length) return rows;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}
