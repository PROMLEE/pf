import type { Market } from "../app/holdings";
export type StockRequest = {
  market: Market;
  symbol: string;
  exchange: string | null;
};
export type StockInstrument = StockRequest & { name: string };
export type StockQuote = StockRequest & {
  price: number | null;
  previousClose: number | null;
  currency: "KRW" | "USD";
  checkedAt: string | null;
  label: string;
  error?: string;
};
