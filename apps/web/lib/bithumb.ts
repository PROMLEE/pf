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
  trade_date?: unknown;
  trade_time?: unknown;
};

function utcTradeTime(row: TickerResponse | undefined) {
  if (
    typeof row?.trade_date !== "string" ||
    typeof row.trade_time !== "string" ||
    !/^\d{8}$/.test(row.trade_date) ||
    !/^\d{6}$/.test(row.trade_time)
  )
    return null;
  const date = row.trade_date;
  const time = row.trade_time;
  const parsed = new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export const validCryptoMarketCode = (value: string) =>
  /^KRW-[A-Z0-9]{2,20}$/.test(value);

export async function listKrwCryptoMarkets(): Promise<CryptoMarket[]> {
  const response = await fetch(
    "https://api.bithumb.com/v1/market/all?isDetails=false",
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw new Error("빗썸 원화마켓 목록을 가져오지 못했습니다.");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload))
    throw new Error("빗썸 마켓 응답을 확인할 수 없습니다.");
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
  const url = new URL("https://api.bithumb.com/v1/ticker");
  url.searchParams.set("markets", markets.join(","));
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("빗썸 원화 시세를 가져오지 못했습니다.");
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload))
    throw new Error("빗썸 시세 응답을 확인할 수 없습니다.");
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
    return {
      marketCode,
      price,
      checkedAt: price === null ? null : checkedAt,
      lastTradeAt: utcTradeTime(row),
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
  await Promise.all(
    quotes.map((quote) =>
      quote.price !== null && quote.checkedAt
        ? setCryptoQuote(
            userId,
            quote.marketCode,
            quote.price,
            quote.checkedAt,
            quote.lastTradeAt,
          )
        : Promise.resolve(),
    ),
  );
  return quotes;
}
