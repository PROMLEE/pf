import type { Holding, Market } from "./holdings";

export type Bucket = {
  id: string;
  name: string;
  targetPercent: number;
  color: string;
};

export type Rule = {
  id: string;
  bucketId: string;
  market: Market;
  symbol: string;
  exchange: string | null;
  name: string;
  manualPrice: number | null;
  quotedPrice: number | null;
  quoteCheckedAt: string | null;
};

export type ManualAsset = {
  id: string;
  bucketId: string | null;
  name: string;
  valueKrw: number;
  valueUsd: number | null;
};

export function manualAssetValueKrw(asset: ManualAsset, usdKrw: number) {
  return asset.valueUsd === null ? asset.valueKrw : asset.valueUsd * usdKrw;
}

export type CryptoAsset = {
  id: string;
  bucketId: string | null;
  marketCode: string;
  name: string;
  quantity: number;
  averageCostKrw: number | null;
  quotedPriceKrw: number | null;
  quoteCheckedAt: string | null;
  lastTradeAt: string | null;
};

export type Assignment = {
  holdingId: string;
  bucketId: string | null;
  source: "auto" | "manual";
};

export type Snapshot = {
  date: string;
  bucketKey: string;
  bucketName: string;
  valueKrw: number;
  targetPercent: number | null;
};

export type CashFlow = {
  id: string;
  date: string;
  amountKrw: number;
  note: string;
};

export type Portfolio = {
  title: string;
  usdKrw: number;
  usdKrwUpdatedAt: string | null;
  usdKrwMode: "auto" | "manual";
  usdKrwRateDate: string | null;
  tolerancePercent: number;
  buckets: Bucket[];
  rules: Rule[];
  manualAssets: ManualAsset[];
  cryptoAssets: CryptoAsset[];
  assignments: Assignment[];
  snapshots: Snapshot[];
  cashFlows: CashFlow[];
};

export function holdingValueKrw(holding: Holding, usdKrw: number) {
  const price = holding.currentPrice ?? holding.capturedPrice;
  if (price === null) return 0;
  return holding.quantity * price * (holding.market === "US" ? usdKrw : 1);
}

export function cryptoAssetValueKrw(asset: CryptoAsset) {
  return asset.quantity * (asset.quotedPriceKrw ?? 0);
}

export function portfolioValues(portfolio: Portfolio, holdings: Holding[]) {
  const values = new Map(portfolio.buckets.map((bucket) => [bucket.id, 0]));
  const assignments = new Map(
    portfolio.assignments.map((item) => [item.holdingId, item]),
  );
  const rules = new Map(
    portfolio.rules.map((rule) => [
      `${rule.market}:${rule.symbol}`,
      rule.bucketId,
    ]),
  );
  let unassigned = 0;
  let missingPrices = 0;
  for (const holding of holdings) {
    if (holding.currentPrice === null && holding.capturedPrice === null)
      missingPrices++;
    const value = holdingValueKrw(holding, portfolio.usdKrw);
    const assignment = assignments.get(holding.id);
    const bucketId =
      assignment?.source === "manual"
        ? assignment.bucketId
        : (rules.get(`${holding.market}:${holding.symbol}`) ?? null);
    if (bucketId && values.has(bucketId)) {
      values.set(bucketId, (values.get(bucketId) ?? 0) + value);
    } else {
      unassigned += value;
    }
  }
  for (const asset of portfolio.manualAssets) {
    const value = manualAssetValueKrw(asset, portfolio.usdKrw);
    if (asset.bucketId && values.has(asset.bucketId)) {
      values.set(asset.bucketId, (values.get(asset.bucketId) ?? 0) + value);
    } else {
      unassigned += value;
    }
  }
  for (const asset of portfolio.cryptoAssets) {
    if (asset.quotedPriceKrw === null) missingPrices++;
    const value = cryptoAssetValueKrw(asset);
    if (asset.bucketId && values.has(asset.bucketId)) {
      values.set(asset.bucketId, (values.get(asset.bucketId) ?? 0) + value);
    } else {
      unassigned += value;
    }
  }
  const total =
    [...values.values()].reduce((sum, value) => sum + value, 0) + unassigned;
  return { values, unassigned, total, missingPrices };
}

export const EXAMPLE_BUCKETS: Omit<Bucket, "id">[] = [
  { name: "미국 지수", targetPercent: 35, color: "#177C88" },
  { name: "한국 지수", targetPercent: 25, color: "#42A994" },
  { name: "우량주", targetPercent: 20, color: "#6986B3" },
  { name: "금", targetPercent: 10, color: "#CBA664" },
  { name: "비트코인", targetPercent: 10, color: "#D88975" },
];

export const EXAMPLE_RULES: {
  bucketIndex: number;
  market: Market;
  symbol: string;
  exchange: string;
  name: string;
}[] = [
  {
    bucketIndex: 0,
    market: "US",
    symbol: "SPY",
    exchange: "AMS",
    name: "SPDR S&P 500",
  },
  {
    bucketIndex: 0,
    market: "US",
    symbol: "QQQ",
    exchange: "NAS",
    name: "Invesco QQQ",
  },
  {
    bucketIndex: 1,
    market: "KR",
    symbol: "069500",
    exchange: "KOSPI",
    name: "KODEX 200",
  },
  {
    bucketIndex: 2,
    market: "KR",
    symbol: "005930",
    exchange: "KOSPI",
    name: "삼성전자",
  },
  {
    bucketIndex: 2,
    market: "KR",
    symbol: "000660",
    exchange: "KOSPI",
    name: "SK하이닉스",
  },
  {
    bucketIndex: 2,
    market: "US",
    symbol: "MSFT",
    exchange: "NAS",
    name: "마이크로소프트",
  },
  {
    bucketIndex: 2,
    market: "US",
    symbol: "GOOGL",
    exchange: "NAS",
    name: "알파벳 A",
  },
  {
    bucketIndex: 3,
    market: "KR",
    symbol: "411060",
    exchange: "KOSPI",
    name: "ACE KRX금현물",
  },
];
