import { unstable_cache } from "next/cache";
import type { Market } from "../app/holdings";
import { tossBase, tossToken } from "./toss-auth";
import {
  tossInstruments,
  tossPriceQuotes,
  previousSessionCutoff,
  tossPreviousClose,
} from "./toss-values";
import { searchInstrumentCatalog } from "./instrument-search";
import type {
  StockInstrument,
  StockRequest,
  StockQuote,
} from "./market-data-types";
export { tossConfigured } from "./toss-auth";
const queues = new Map<string, { tail: Promise<void>; next: number }>();
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function pace(group: string) {
  const state = queues.get(group) ?? { tail: Promise.resolve(), next: 0 };
  queues.set(group, state);
  const task = state.tail.then(async () => {
    await pause(Math.max(0, state.next - Date.now()));
    state.next =
      Date.now() +
      (group === "catalog" ? 1100 : group === "candles" ? 100 : 120);
  });
  state.tail = task.catch(() => {});
  await task;
}
export async function tossGet(
  path: string,
  params: Record<string, string>,
  group = "prices",
): Promise<unknown> {
  let token = await tossToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    await pace(group);
    const response = await fetch(
      `${tossBase()}${path}?${new URLSearchParams(params)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 401 && attempt === 0) {
      token = await tossToken(token);
      continue;
    }
    if (response.status === 429 && attempt === 0) {
      await pause(
        Math.min(
          2000,
          Math.max(
            1000,
            Number(response.headers.get("retry-after")) * 1000 || 1000,
          ),
        ),
      );
      continue;
    }
    if (!response.ok)
      throw Error(
        response.status === 403
          ? "토스증권 허용 IP 또는 API 이용 권한을 확인해 주세요."
          : response.status === 429
            ? "토스증권 조회 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
            : `토스증권 시세 요청 실패 (${response.status})`,
      );
    const payload = await response.json();
    if (!payload || !("result" in payload))
      throw Error("토스증권 응답 형식을 확인할 수 없습니다.");
    return payload.result;
  }
  throw Error("토스증권 API 재시도 실패");
}
const catalogCache = new Map<
  Market,
  { rows: StockInstrument[]; until: number }
>();
const pendingCatalog = new Map<Market, Promise<StockInstrument[]>>();
const cachedMarket = unstable_cache(
  async (exchange: string) =>
    tossInstruments(
      await tossGet(
        "/api/v1/stocks/all",
        { market: exchange, status: "ACTIVE" },
        "catalog",
      ),
      exchange,
    ),
  ["pf-toss-instruments-v1"],
  { revalidate: 21600 },
);
export async function findTossInstruments(market: Market, query: string) {
  if (!query.trim()) return [];
  let rows = catalogCache.get(market);
  if (!rows || rows.until < Date.now()) {
    let pending = pendingCatalog.get(market);
    if (!pending) {
      pending = (async () => {
        const result: StockInstrument[] = [];
        for (const exchange of market === "KR"
          ? ["KOSPI", "KOSDAQ"]
          : ["NASDAQ", "NYSE", "AMEX"])
          result.push(...(await cachedMarket(exchange)));
        catalogCache.set(market, {
          rows: result,
          until: Date.now() + 21600000,
        });
        return result;
      })();
      pendingCatalog.set(market, pending);
      void pending.finally(() => pendingCatalog.delete(market)).catch(() => {});
    }
    rows = { rows: await pending, until: 0 };
  }
  return searchInstrumentCatalog(rows.rows, query);
}
const cachedPrevious = unstable_cache(
  async (symbol: string, market: Market, cutoff: string) => {
    const response = await tossGet(
      "/api/v1/candles",
      { symbol, interval: "1d", count: "5", before: cutoff, adjusted: "true" },
      "candles",
    );
    const value = tossPreviousClose(
      (response as { candles?: unknown })?.candles,
      cutoff,
      market === "KR" ? "KRW" : "USD",
    );
    if (value === null) throw Error("토스증권 전일 종가를 확인할 수 없습니다.");
    return value;
  },
  ["pf-toss-previous-close-v1"],
  { revalidate: 3600 },
);
export async function quoteTossBatch(
  requests: StockRequest[],
): Promise<StockQuote[]> {
  const results: StockQuote[] = [];
  for (let offset = 0; offset < requests.length; offset += 200) {
    const chunk = requests.slice(offset, offset + 200);
    const data = await tossGet("/api/v1/prices", {
      symbols: [...new Set(chunk.map((row) => row.symbol))].join(","),
    });
    const quotes = tossPriceQuotes(chunk, data);
    const enriched = await Promise.all(
      quotes.map(async (quote) => {
        if (quote.price === null) return quote;
        const source = (
          data as { symbol: string; currency: string; timestamp?: unknown }[]
        ).find(
          (row) =>
            row.symbol === quote.symbol && row.currency === quote.currency,
        );
        const cutoff = previousSessionCutoff(source?.timestamp, quote.market);
        if (cutoff)
          quote.previousClose = await cachedPrevious(
            quote.symbol,
            quote.market,
            cutoff,
          ).catch(() => null);
        return quote;
      }),
    );
    results.push(...enriched);
  }
  return results;
}
