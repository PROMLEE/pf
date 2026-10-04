export type AssetClass =
  | "equity"
  | "bond"
  | "cash"
  | "crypto"
  | "commodity"
  | "other";

export type SyncProvider = "notion" | "manual";

export interface Holding {
  symbol: string;
  name?: string;
  amount: number;
  marketValue: number;
  assetClass: AssetClass;
}

export interface AllocationTarget {
  assetClass: AssetClass;
  targetPercent: number;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface PriceQuote {
  symbol: string;
  price: number;
  currency: string;
  asOf: string;
  provider: string;
}

export interface AssetSnapshot {
  source: "broker" | "csv" | "image-ocr";
  importedAt: string;
  holdings: Holding[];
}
