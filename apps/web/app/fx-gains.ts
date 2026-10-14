import type { Holding } from "./holdings";
import type { ManualAsset } from "./portfolio-model";

export const validFx = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 100 && n <= 100000;
export const validBasis = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 && n < 1e15;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
export function stockGains(holding: Holding, rate: number, includeFx = false) {
  const price = holding.currentPrice ?? holding.capturedPrice;
  const dollarCost = holding.averageCost;
  const isUsd = holding.market === "US";
  const basis =
    isUsd && includeFx
      ? (holding.averageCostKrw ?? null)
      : dollarCost === null
        ? null
        : dollarCost * (isUsd ? rate : 1);
  const value =
    price === null ? null : price * holding.quantity * (isUsd ? rate : 1);
  const cost = basis === null ? null : basis * holding.quantity;
  const gain = value === null || cost === null ? null : value - cost;
  const priceGain =
    price === null || dollarCost === null
      ? null
      : (price - dollarCost) * holding.quantity * (isUsd ? rate : 1);
  const fxGain = !isUsd
    ? 0
    : cost === null || dollarCost === null
      ? null
      : dollarCost * holding.quantity * rate - cost;
  return {
    value,
    cost,
    gain,
    priceGain,
    fxGain,
    percent: gain === null || !cost ? null : (gain / cost) * 100,
  };
}
export function cashGains(asset: ManualAsset, rate: number) {
  if (asset.valueUsd === 0) return { gain: 0, cost: 0, percent: null };
  if (asset.valueUsd === null || !validFx(asset.averageFxRate))
    return { gain: null, cost: null, percent: null };
  const cost = asset.valueUsd * asset.averageFxRate;
  const gain = asset.valueUsd * rate - cost;
  return { gain, cost, percent: cost > 0 ? (gain / cost) * 100 : null };
}
export function dailyUsdGains(
  price: number,
  previousClose: number,
  quantity: number,
  rate: number,
  previousRate: number | null,
  includeFx: boolean,
) {
  if (includeFx && !validFx(previousRate)) return null;
  const base = previousClose * quantity * (includeFx ? previousRate! : rate);
  return { gain: price * quantity * rate - base, base };
}
export function nextStockBasis(
  quantity: number,
  basis: number | null,
  side: "buy" | "sell",
  shares: number,
  price: number,
  fee: number,
  rate: number,
) {
  if (side === "sell") return shares === quantity ? null : basis;
  if (quantity > 0 && basis === null) return null;
  return round(
    (quantity * (basis ?? 0) + (shares * price + fee) * rate) /
      (quantity + shares),
  );
}
export function nextCashFx(
  balance: number,
  average: number | null,
  delta: number,
  rate: number,
) {
  if (balance + delta === 0) return null;
  if (delta <= 0) return average;
  if (balance > 0 && average === null) return null;
  return round((balance * (average ?? 0) + delta * rate) / (balance + delta));
}
