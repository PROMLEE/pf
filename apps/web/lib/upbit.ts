export type CryptoMarket = {
  marketCode: string;
  name: string;
  englishName: string;
};

export type CryptoQuote = {
  marketCode: string;
  price: number | null;
  checkedAt: string | null;
  lastTradeAt: string | null;
  error?: string;
};

type MarketResponse = {
  market?: unknown;
  korean_name?: unknown;
  english_name?: unknown;
};

type TickerResponse = {
  market?: unknown;
  trade_price?: unknown;
  trade_timestamp?: unknown;
};

export const validCryptoMarketCode = (value: string) =>
  /^KRW-[A-Z0-9]{2,20}$/.test(value);

export async function listKrwCryptoMarkets(): Promise<CryptoMarket[]> {
  const response = await fetch(
    "https://api.upbit.com/v1/market/all?is_details=false",
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw new Error("업비트 원화마켓 목록을 가져오지 못했습니다.");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload))
    throw new Error("업비트 마켓 응답을 확인할 수 없습니다.");
  return (payload as MarketResponse[])
    .filter(
      (row) =>
        typeof row.market === "string" &&
        validCryptoMarketCode(row.market) &&
        typeof row.korean_name === "string" &&
        typeof row.english_name === "string",
    )
    .map((row) => ({
      marketCode: row.market as string,
      name: row.korean_name as string,
      englishName: row.english_name as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
}

export async function quoteKrwCryptoMarkets(
  codes: string[],
): Promise<CryptoQuote[]> {
  const markets = [...new Set(codes)];
  if (!markets.length) return [];
  if (
    markets.length > 100 ||
    markets.some((code) => !validCryptoMarketCode(code))
  )
    throw new Error("조회할 가상자산 코드를 확인해 주세요.");
  const url = new URL("https://api.upbit.com/v1/ticker");
  url.searchParams.set("markets", markets.join(","));
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("업비트 원화 시세를 가져오지 못했습니다.");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload))
    throw new Error("업비트 시세 응답을 확인할 수 없습니다.");
  const byCode = new Map(
    (payload as TickerResponse[])
      .filter(
        (row) => typeof row.market === "string" && markets.includes(row.market),
      )
      .map((row) => [row.market as string, row]),
  );
  const checkedAt = new Date().toISOString();
  return markets.map((marketCode) => {
    const row = byCode.get(marketCode);
    const price =
      typeof row?.trade_price === "number" &&
      Number.isFinite(row.trade_price) &&
      row.trade_price > 0
        ? row.trade_price
        : null;
    const tradeMs =
      typeof row?.trade_timestamp === "number" &&
      Number.isFinite(row.trade_timestamp) &&
      row.trade_timestamp > 0 &&
      row.trade_timestamp < 8.64e15
        ? row.trade_timestamp
        : null;
    return {
      marketCode,
      price,
      checkedAt: price === null ? null : checkedAt,
      lastTradeAt: tradeMs === null ? null : new Date(tradeMs).toISOString(),
      ...(price === null
        ? { error: "해당 원화마켓의 시세를 확인하지 못했습니다." }
        : {}),
    };
  });
}

export async function refreshStoredCryptoQuotes(userId: string) {
  const { listCryptoAssets, setCryptoQuote } = await import("./portfolio-db");
  const codes = await listCryptoAssets(userId);
  const quotes = await quoteKrwCryptoMarkets(codes);
  for (const quote of quotes) {
    if (quote.price !== null && quote.checkedAt)
      await setCryptoQuote(
        userId,
        quote.marketCode,
        quote.price,
        quote.checkedAt,
        quote.lastTradeAt,
      );
  }
  return quotes;
}
