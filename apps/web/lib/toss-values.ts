import type { Market } from "../app/holdings";
import type {
  StockInstrument,
  StockQuote,
  StockRequest,
} from "./market-data-types";
const exchanges: Record<string, string> = {
  KOSPI: "KOSPI",
  KOSDAQ: "KOSDAQ",
  NASDAQ: "NAS",
  NYSE: "NYS",
  AMEX: "AMS",
};
const positive = (value: unknown) =>
  (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
  Number.isFinite(Number(value)) &&
  Number(value) > 0
    ? Number(value)
    : null;
export function tossInstruments(
  value: unknown,
  exchange: string,
): StockInstrument[] {
  if (!Array.isArray(value) || !exchanges[exchange])
    throw Error("토스증권 종목 목록 형식을 확인할 수 없습니다.");
  const market: Market = exchange.startsWith("KOS") ? "KR" : "US";
  return value
    .filter(
      (row) =>
        row &&
        typeof row.symbol === "string" &&
        (market === "KR" ? /^[0-9A-Z]{6}$/ : /^[A-Z.]{1,10}$/).test(
          row.symbol,
        ) &&
        typeof row.name === "string" &&
        row.name.trim(),
    )
    .map((row) => ({
      market,
      symbol: row.symbol,
      name: row.name.trim(),
      exchange: exchanges[exchange],
    }));
}
export function tossPriceQuotes(
  rows: StockRequest[],
  value: unknown,
): StockQuote[] {
  if (!Array.isArray(value))
    throw Error("토스증권 현재가 응답 형식을 확인할 수 없습니다.");
  return rows.map((row) => {
    const currency = row.market === "KR" ? "KRW" : "USD";
    const result = value.find(
      (item) => item?.symbol === row.symbol && item.currency === currency,
    );
    const price = positive(result?.lastPrice);
    return {
      ...row,
      price,
      previousClose: null,
      currency,
      checkedAt: price === null ? null : new Date().toISOString(),
      label: "토스증권 현재가",
      ...(price === null
        ? { error: `${row.symbol} 토스증권 시세를 확인할 수 없습니다.` }
        : {}),
    };
  });
}
/** Use the quote's trading date, so weekends retain the last session's daily change. */
export function previousSessionCutoff(
  timestamp: unknown,
  market: Market,
): string | null {
  if (
    typeof timestamp !== "string" ||
    !Number.isFinite(Date.parse(timestamp)) ||
    Date.parse(timestamp) > Date.now() + 300000
  )
    return null;
  const zone = market === "KR" ? "Asia/Seoul" : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (key: string) => parts.find((item) => item.type === key)!.value;
  const midnight = Date.parse(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00Z`,
  );
  let result = midnight;
  for (let i = 0; i < 2; i++) {
    const offset =
      new Intl.DateTimeFormat("en", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(new Date(result))
        .find((item) => item.type === "timeZoneName")?.value ?? "GMT";
    const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    const minutes = match
      ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1)
      : 0;
    result = midnight - minutes * 60000;
  }
  return new Date(result).toISOString();
}
export function tossPreviousClose(
  value: unknown,
  cutoff: string,
  currency: string,
): number | null {
  if (!Array.isArray(value)) return null;
  const rows = value
    .filter(
      (row) =>
        row?.currency === currency &&
        typeof row.timestamp === "string" &&
        Number.isFinite(Date.parse(row.timestamp)) &&
        Date.parse(row.timestamp) < Date.parse(cutoff) &&
        positive(row.closePrice) !== null,
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return rows.length ? positive(rows[0].closePrice) : null;
}
