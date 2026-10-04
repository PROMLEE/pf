import type { Holding } from "./holdings";
import {
  holdingValueKrw,
  portfolioValues,
  type Bucket,
  type Portfolio,
} from "./portfolio-model";

export type RebalanceMode = "trade" | "add-only";
export type Trade = {
  bucketId: string;
  holdingId: string | null;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  amountKrw: number;
};
export type RebalanceItem = {
  bucket: Bucket;
  current: number;
  currentPercent: number;
  gapPercent: number;
  projectedPercent: number;
  advice: string;
};

const fmt = (value: number) =>
  `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value)}원`;

function bucketFor(holding: Holding, plan: Portfolio) {
  const assignment = plan.assignments.find(
    (item) => item.holdingId === holding.id,
  );
  return assignment?.source === "manual"
    ? assignment.bucketId
    : (plan.rules.find(
        (rule) =>
          rule.market === holding.market && rule.symbol === holding.symbol,
      )?.bucketId ?? null);
}

export function needsAdjustment(
  target: number,
  current: number,
  currentPercent: number,
  tolerance: number,
) {
  return (
    (target > 0 && current === 0) ||
    Math.abs(target - currentPercent) > tolerance
  );
}

export function rebalance(
  plan: Portfolio,
  holdings: Holding[],
  mode: RebalanceMode,
  newCash: number | null,
  excludedHoldingIds: Set<string>,
) {
  const { values, unassigned, total, missingPrices } = portfolioValues(
    plan,
    holdings,
  );
  const ready = total > 0 && unassigned === 0 && missingPrices === 0;
  const currentPct = (bucket: Bucket) =>
    total > 0 ? ((values.get(bucket.id) ?? 0) / total) * 100 : 0;
  const withinRange = plan.buckets.every(
    (bucket) =>
      !needsAdjustment(
        bucket.targetPercent,
        values.get(bucket.id) ?? 0,
        currentPct(bucket),
        plan.tolerancePercent,
      ),
  );
  const impossibleWithoutSelling =
    mode === "add-only" &&
    plan.tolerancePercent === 0 &&
    plan.buckets.some(
      (bucket) =>
        bucket.targetPercent === 0 && (values.get(bucket.id) ?? 0) > 0,
    );
  const theoreticalCash =
    mode === "add-only" && !withinRange && !impossibleWithoutSelling
      ? Math.max(
          0,
          ...plan.buckets
            .filter((bucket) => bucket.targetPercent > 0)
            .map(
              (bucket) =>
                (values.get(bucket.id) ?? 0) / (bucket.targetPercent / 100) -
                total,
            ),
          ...plan.buckets
            .filter(
              (bucket) =>
                bucket.targetPercent === 0 &&
                (values.get(bucket.id) ?? 0) > 0 &&
                plan.tolerancePercent > 0,
            )
            .map(
              (bucket) =>
                (values.get(bucket.id) ?? 0) / (plan.tolerancePercent / 100) -
                total,
            ),
        )
      : 0;
  const cash = mode === "add-only" ? (newCash ?? theoreticalCash) : 0;
  const targetTotal = total + cash;
  const projected = new Map(values);
  const trades: Trade[] = [];
  let available = mode === "add-only" ? cash : 0;

  if (ready && !impossibleWithoutSelling && (!withinRange || cash > 0)) {
    if (mode === "trade") {
      for (const bucket of plan.buckets) {
        const current = values.get(bucket.id) ?? 0;
        const excess = current - (targetTotal * bucket.targetPercent) / 100;
        if (
          excess <= 0 ||
          !needsAdjustment(
            bucket.targetPercent,
            current,
            currentPct(bucket),
            plan.tolerancePercent,
          )
        )
          continue;
        let remaining = excess;
        const owned = holdings
          .filter(
            (row) =>
              bucketFor(row, plan) === bucket.id &&
              !excludedHoldingIds.has(row.id),
          )
          .sort(
            (a, b) =>
              holdingValueKrw(b, plan.usdKrw) - holdingValueKrw(a, plan.usdKrw),
          );
        for (const holding of owned) {
          const unit =
            (holding.currentPrice ?? holding.capturedPrice ?? 0) *
            (holding.market === "US" ? plan.usdKrw : 1);
          if (unit <= 0) continue;
          const shares = Math.min(
            Math.floor(holding.quantity),
            Math.floor(remaining / unit),
          );
          if (shares < 1) continue;
          const amountKrw = shares * unit;
          trades.push({
            bucketId: bucket.id,
            holdingId: holding.id,
            symbol: holding.symbol || holding.name,
            side: "sell",
            shares,
            amountKrw,
          });
          projected.set(bucket.id, (projected.get(bucket.id) ?? 0) - amountKrw);
          available += amountKrw;
          remaining -= amountKrw;
        }
      }
    }
    const deficits = plan.buckets
      .map((bucket) => ({
        bucket,
        gap:
          (targetTotal * bucket.targetPercent) / 100 -
          (values.get(bucket.id) ?? 0),
      }))
      .filter(
        ({ bucket, gap }) =>
          gap > 0 &&
          ((gap / targetTotal) * 100 > plan.tolerancePercent ||
            (values.get(bucket.id) ?? 0) === 0),
      )
      .sort((a, b) => b.gap - a.gap);
    for (const { bucket, gap } of deficits) {
      const rules = plan.rules.filter(
        (rule) =>
          rule.bucketId === bucket.id &&
          !holdings.some(
            (holding) =>
              holding.market === rule.market &&
              holding.symbol === rule.symbol &&
              excludedHoldingIds.has(holding.id),
          ),
      );
      const priced = rules
        .map((rule) => {
          const owned = holdings.find(
            (holding) =>
              holding.market === rule.market &&
              holding.symbol === rule.symbol &&
              !excludedHoldingIds.has(holding.id),
          );
          const unit =
            (rule.quotedPrice ??
              owned?.currentPrice ??
              rule.manualPrice ??
              owned?.capturedPrice ??
              0) * (rule.market === "US" ? plan.usdKrw : 1);
          return { rule, unit, owned };
        })
        .find(({ unit }) => unit > 0);
      if (!priced || available <= 0) continue;
      const shares = Math.floor(Math.min(gap, available) / priced.unit);
      if (shares < 1) continue;
      const amountKrw = shares * priced.unit;
      trades.push({
        bucketId: bucket.id,
        holdingId: priced.owned?.id ?? null,
        symbol: priced.rule.symbol,
        side: "buy",
        shares,
        amountKrw,
      });
      projected.set(bucket.id, (projected.get(bucket.id) ?? 0) + amountKrw);
      available -= amountKrw;
    }
  }
  const items: RebalanceItem[] = plan.buckets.map((bucket) => {
    const current = values.get(bucket.id) ?? 0;
    const currentPercent = currentPct(bucket);
    const gapPercent = bucket.targetPercent - currentPercent;
    const bucketTrades = trades.filter((trade) => trade.bucketId === bucket.id);
    let advice = bucketTrades.length
      ? bucketTrades
          .map(
            (trade) =>
              `${trade.symbol} ${trade.shares}주 ${trade.side === "buy" ? "매수" : "매도"} · 약 ${fmt(trade.amountKrw)}`,
          )
          .join(" / ")
      : "";
    if (!ready)
      advice = missingPrices
        ? `가격 미확인 ${missingPrices}개를 확인해 주세요.`
        : unassigned
          ? "미분류 자산을 배정해 주세요."
          : "가격이 있는 자산을 등록해 주세요.";
    else if (impossibleWithoutSelling)
      advice = "목표 0% 자산이 있어 매수만으로 조정할 수 없습니다.";
    else if (
      (withinRange && cash === 0) ||
      (!needsAdjustment(
        bucket.targetPercent,
        current,
        currentPercent,
        plan.tolerancePercent,
      ) &&
        !bucketTrades.length)
    )
      advice = "허용 오차 안에 있습니다.";
    else if (!advice)
      advice =
        mode === "add-only" && gapPercent < 0
          ? "현재 수량 유지"
          : plan.manualAssets.some((asset) => asset.bucketId === bucket.id)
            ? "직접 입력 자산의 거래 금액을 검토하세요."
            : mode === "trade" && gapPercent < 0
              ? "매도 가능한 1주 단위가 없거나 제외된 종목입니다."
              : "매수 자금·종목 가격·1주 단위를 확인하세요.";
    return {
      bucket,
      current,
      currentPercent,
      gapPercent,
      projectedPercent:
        targetTotal > 0
          ? ((projected.get(bucket.id) ?? 0) / targetTotal) * 100
          : 0,
      advice,
    };
  });
  return {
    items,
    trades,
    ready,
    requiredCash: theoreticalCash,
    newCash: cash,
    residualCash: available,
    projectedUnassignedPercent:
      targetTotal > 0 ? (available / targetTotal) * 100 : 0,
  };
}
