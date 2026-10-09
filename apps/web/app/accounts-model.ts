import type { Holding } from "./holdings";
export type BrokerageAccount = { id: string; broker: string; name: string };

export function purchaseTotal(quantity: string, cost: string): number | null {
  if (!quantity.trim() || !cost.trim()) return null;
  const shares = Number(quantity),
    price = Number(cost);
  const total = shares * price;
  return Number.isFinite(total) && shares > 0 && price > 0 ? total : null;
}

// Keep currencies separate; partial prices must not appear as a full account balance.
export function accountValuation(rows: Holding[]) {
  const result = {
    KR: { value: 0, count: 0, priced: 0 },
    US: { value: 0, count: 0, priced: 0 },
    unpriced: 0,
    captured: 0,
    oldestCheckedAt: null as string | null,
  };
  for (const row of rows) {
    result[row.market].count++;
    const price = row.currentPrice ?? row.capturedPrice;
    if (price === null || !Number.isFinite(price)) {
      result.unpriced++;
      continue;
    }
    result[row.market].priced++;
    result[row.market].value += row.quantity * price;
    if (row.currentPrice === null) result.captured++;
    else if (
      row.quoteCheckedAt &&
      Number.isFinite(Date.parse(row.quoteCheckedAt)) &&
      (!result.oldestCheckedAt ||
        Date.parse(row.quoteCheckedAt) < Date.parse(result.oldestCheckedAt))
    )
      result.oldestCheckedAt = row.quoteCheckedAt;
  }
  return result;
}
