import type { Holding, Market } from "./holdings";
import {
  holdingBucketId,
  holdingValueKrw,
  portfolioValues,
  type Bucket,
  type Portfolio,
  type Rule,
} from "./portfolio-model";

export type RebalanceMode = "trade" | "add-only";
export type RebalanceOptions = {
  candidatePolicy?: "priority" | "fallback";
  excludedBuySymbols?: Set<string>;
  buyHoldingIds?: Record<string, string>;
};
export type AppliedPrice = {
  unitPrice: number;
  unitKrw: number;
  currency: "KRW" | "USD";
  priceSource: string;
  checkedAt: string | null;
};
export type Trade = AppliedPrice & {
  bucketId: string;
  holdingId: string | null;
  ruleId: string | null;
  market: Market;
  symbol: string;
  side: "buy" | "sell";
  shares: number;
  amountKrw: number;
  broker: string | null;
  account: string | null;
  usdKrw: number | null;
  selectionReason: string;
};
export type CandidateEvaluation = AppliedPrice & {
  ruleId: string;
  holdingId: string | null;
  status: "selected" | "not-selected" | "blocked";
  reason: string;
};
export type RebalanceItem = {
  bucket: Bucket;
  current: number;
  currentPercent: number;
  gapPercent: number;
  fundedGapPercent: number;
  projectedPercent: number;
  remainingGapKrw: number;
  advice: string;
  separateReview: string | null;
};
const fmt = (value: number) =>
  `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value)}원`;
export const symbolKey = (market: Market, symbol: string) =>
  `${market}:${symbol}`;
const positive = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function candidatePrice(
  plan: Portfolio,
  rule: Pick<Rule, "market"> & Partial<Rule>,
  owned?: Holding,
): AppliedPrice {
  // An existing holding must use the same price as portfolioValues. Otherwise
  // changing only its quantity cannot reproduce the displayed projection.
  const price = owned
    ? positive(owned.currentPrice)
      ? {
          value: owned.currentPrice!,
          source: owned.quoteLabel || "보유 종목 조회 시세",
          at: owned.quoteCheckedAt,
        }
      : positive(owned.capturedPrice)
        ? {
            value: owned.capturedPrice!,
            source: "보유 종목 입력 가격",
            at: owned.capturedAt,
          }
        : { value: 0, source: "가격 미확인", at: null }
    : positive(rule.quotedPrice)
      ? {
          value: rule.quotedPrice!,
          source: "KIS 후보 조회 시세",
          at: rule.quoteCheckedAt ?? null,
        }
      : positive(rule.manualPrice)
        ? { value: rule.manualPrice!, source: "후보 임시 가격", at: null }
        : { value: 0, source: "가격 미확인", at: null };
  return {
    unitPrice: price.value,
    unitKrw: price.value * (rule.market === "US" ? plan.usdKrw : 1),
    currency: rule.market === "US" ? "USD" : "KRW",
    priceSource: price.source,
    checkedAt: price.at,
  };
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
  options: RebalanceOptions = {},
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
  const cash =
    mode === "add-only"
      ? newCash === null
        ? theoreticalCash
        : Number.isFinite(newCash)
          ? Math.max(0, newCash)
          : 0
      : 0;
  const targetTotal = total + cash;
  const projectedHoldings = holdings.map((holding) => ({ ...holding }));
  const projectedAssignments = [...plan.assignments];
  const trades: Trade[] = [];
  const reasons = new Map<string, string[]>();
  const addReason = (id: string, reason: string) =>
    reasons.set(id, [...(reasons.get(id) ?? []), reason]);
  let available = mode === "add-only" ? cash : 0;
  const candidates: CandidateEvaluation[] = plan.rules.map((rule) => {
    const sameCode = holdings.filter(
      (holding) =>
        holding.market === rule.market && holding.symbol === rule.symbol,
    );
    const eligible = sameCode.filter(
      (holding) => holdingBucketId(plan, holding) === rule.bucketId,
    );
    const selectedId = options.buyHoldingIds?.[rule.id];
    const owned = selectedId
      ? eligible.find((holding) => holding.id === selectedId)
      : eligible[0];
    const price = candidatePrice(plan, rule, owned);
    const reason = options.excludedBuySymbols?.has(
      symbolKey(rule.market, rule.symbol),
    )
      ? "이 종목의 추가 매수 제외"
      : selectedId && !owned
        ? "선택 계좌의 현재 배정이 후보 포트와 다릅니다. 계좌를 다시 선택하세요."
        : sameCode.length && !owned
          ? "보유 항목의 직접 배정과 후보 포트가 다릅니다. 자산 배정에서 일치시킨 뒤 계산하세요."
          : price.unitKrw <= 0
            ? "적용 가격이 없습니다. 시세를 조회하거나 새 후보의 임시 가격을 입력하세요."
            : owned
              ? selectedId
                ? "사용자가 선택한 보유 계좌"
                : "같은 포트에 배정된 첫 보유 계좌 (목록 순서)"
              : "신규 종목: 거래 계좌 선택 후 새 보유 항목 등록 필요";
    return {
      ...price,
      ruleId: rule.id,
      holdingId: owned?.id ?? null,
      status:
        options.excludedBuySymbols?.has(symbolKey(rule.market, rule.symbol)) ||
        (selectedId && !owned) ||
        (sameCode.length > 0 && !owned) ||
        price.unitKrw <= 0
          ? "blocked"
          : "not-selected",
      reason,
    };
  });

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
              holdingBucketId(plan, row) === bucket.id &&
              !excludedHoldingIds.has(row.id),
          )
          .sort(
            (a, b) =>
              holdingValueKrw(b, plan.usdKrw) - holdingValueKrw(a, plan.usdKrw),
          );
        for (const holding of owned) {
          const price = candidatePrice(
            plan,
            { market: holding.market },
            holding,
          );
          if (price.unitKrw <= 0) continue;
          const shares = Math.min(
            Math.floor(holding.quantity),
            Math.floor(remaining / price.unitKrw),
          );
          if (shares < 1) continue;
          const amountKrw = shares * price.unitKrw;
          trades.push({
            ...price,
            bucketId: bucket.id,
            holdingId: holding.id,
            ruleId: null,
            market: holding.market,
            symbol: holding.symbol || holding.name,
            side: "sell",
            shares,
            amountKrw,
            broker: holding.broker,
            account: holding.account,
            usdKrw: holding.market === "US" ? plan.usdKrw : null,
            selectionReason:
              "포트 내 매도 제외되지 않은 보유 항목을 평가액 순으로 검토",
          });
          projectedHoldings.find((row) => row.id === holding.id)!.quantity -=
            shares;
          available += amountKrw;
          remaining -= amountKrw;
        }
        if (remaining > 0) {
          const stocks = holdings.filter((row) => holdingBucketId(plan, row) === bucket.id);
          addReason(bucket.id, !stocks.length
            ? "이 포트에는 자동 매도할 주식이 없습니다. 별도 검토 자산을 확인하세요."
            : !owned.length ? "모든 보유 주식이 매도 제외되었습니다."
            : "주식 제안으로 채우지 못한 초과분이 있습니다. 매도 제외·1주 단위와 별도 검토 자산을 확인하세요.");
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
      const rules = plan.rules.filter((rule) => rule.bucketId === bucket.id);
      if (available <= 0) {
        addReason(bucket.id, "이번 계산에서 사용할 매수 자금이 없습니다.");
        continue;
      }
      let selected: {
        rule: Rule;
        candidate: CandidateEvaluation;
        shares: number;
      } | null = null;
      for (const rule of rules) {
        const candidate = candidates.find((item) => item.ruleId === rule.id)!;
        if (candidate.status === "blocked") {
          addReason(bucket.id, `${rule.symbol}: ${candidate.reason}`);
          if (options.candidatePolicy !== "fallback") {
            addReason(
              bucket.id,
              "우선 후보만 사용하므로 다음 후보는 검토하지 않았습니다.",
            );
            break;
          }
          continue;
        }
        const shares = Math.floor(Math.min(gap, available) / candidate.unitKrw);
        if (shares > 0) {
          selected = { rule, candidate, shares };
          break;
        }
        candidate.reason =
          available <= 0
            ? "이번 계산에서 사용할 매수 자금이 없습니다."
            : `1주 가격 ${fmt(candidate.unitKrw)}이 부족분·가용 예산 ${fmt(Math.min(gap, available))}을 초과합니다.`;
        addReason(bucket.id, `${rule.symbol}: ${candidate.reason}`);
        if (options.candidatePolicy !== "fallback") {
          addReason(
            bucket.id,
            "우선 후보만 사용하므로 다음 후보는 검토하지 않았습니다. 후보 순서 또는 자동 대체 설정을 확인하세요.",
          );
          break;
        }
      }
      if (!selected) {
        if (!rules.length) addReason(bucket.id, "등록된 매수 후보가 없습니다.");
        continue;
      }
      const { rule, candidate, shares } = selected;
      candidate.status = "selected";
      const owned = holdings.find((row) => row.id === candidate.holdingId);
      const amountKrw = shares * candidate.unitKrw;
      trades.push({
        ...candidate,
        bucketId: bucket.id,
        holdingId: candidate.holdingId,
        ruleId: rule.id,
        market: rule.market,
        symbol: rule.symbol,
        side: "buy",
        shares,
        amountKrw,
        broker: owned?.broker ?? null,
        account: owned?.account ?? null,
        usdKrw: rule.market === "US" ? plan.usdKrw : null,
        selectionReason: `${options.candidatePolicy === "fallback" ? "순서대로 매수 가능한 후보 검토" : "우선 후보 사용"} · ${candidate.reason}`,
      });
      if (owned)
        projectedHoldings.find((row) => row.id === owned.id)!.quantity +=
          shares;
      else {
        const id = `rebalance-new:${rule.id}`;
        projectedHoldings.push({
          id,
          market: rule.market,
          symbol: rule.symbol,
          exchange: rule.exchange,
          name: rule.name,
          broker: "계좌 선택 필요",
          account: "",
          quantity: shares,
          currentPrice: candidate.unitPrice,
          capturedPrice: null,
          averageCost: null,
          capturedAt: "",
          quoteLabel: candidate.priceSource,
          quoteCheckedAt: candidate.checkedAt,
        });
        projectedAssignments.push({
          holdingId: id,
          bucketId: bucket.id,
          source: "manual",
        });
      }
      available -= amountKrw;
    }
  }
  for (const candidate of candidates) {
    if (candidate.status !== "not-selected") continue;
    // Preserve explicit affordability failures; explain untouched candidates.
    if (!candidate.reason.startsWith("같은 포트") && !candidate.reason.startsWith("사용자가 선택") && !candidate.reason.startsWith("신규 종목")) continue;
    const rule = plan.rules.find((item) => item.id === candidate.ruleId)!;
    const bucket = plan.buckets.find((item) => item.id === rule.bucketId);
    const fundedPercent = targetTotal > 0 ? (values.get(rule.bucketId) ?? 0) / targetTotal * 100 : 0;
    candidate.reason = !ready ? "자산 배정·가격 확인을 마친 뒤 계산합니다."
      : bucket && !needsAdjustment(bucket.targetPercent, values.get(bucket.id) ?? 0, fundedPercent, plan.tolerancePercent) ? "계산 기준 비중이 허용 오차 안에 있어 매수 대상이 아닙니다."
      : bucket && fundedPercent >= bucket.targetPercent ? "계산 기준 비중이 초과되어 추가 매수하지 않습니다."
      : trades.some((trade) => trade.side === "buy" && trade.bucketId === rule.bucketId) ? "앞선 우선 후보를 선택하여 이 후보는 사용하지 않았습니다."
      : "이 포트에는 생성된 매수 제안이 없습니다. 포트별 예산·우선 후보 안내를 확인하세요.";
  }
  // Recompute with the same aggregation path used after real quantity edits.
  const projected = portfolioValues(
    {
      ...plan,
      assignments: projectedAssignments,
      manualAssets: available > 0
        ? [...plan.manualAssets, { id: "rebalance:residual", bucketId: null, name: "미배정 잔여 자금", valueKrw: available, valueUsd: null }]
        : plan.manualAssets,
    },
    projectedHoldings,
  );
  const items: RebalanceItem[] = plan.buckets.map((bucket) => {
    const current = values.get(bucket.id) ?? 0;
    const currentPercent = currentPct(bucket);
    const fundedGapPercent =
      bucket.targetPercent -
      (targetTotal > 0 ? (current / targetTotal) * 100 : 0);
    const projectedValue = projected.values.get(bucket.id) ?? 0;
    const remainingGapKrw =
      (targetTotal * bucket.targetPercent) / 100 - projectedValue;
    const bucketTrades = trades.filter((trade) => trade.bucketId === bucket.id);
    const separate = [
      ...plan.cryptoAssets
        .filter((asset) => asset.bucketId === bucket.id)
        .map((asset) => `가상자산 ${asset.name}`),
      ...plan.manualAssets
        .filter((asset) => asset.bucketId === bucket.id)
        .map((asset) => `직접 입력 ${asset.name}`),
    ];
    let advice = bucketTrades
      .map(
        (trade) =>
          `${trade.symbol} ${trade.shares}주 ${trade.side === "buy" ? "매수" : "매도"} · 약 ${fmt(trade.amountKrw)}`,
      )
      .join(" / ");
    if (!ready)
      advice = missingPrices
        ? `가격 미확인 ${missingPrices}개를 확인해 주세요.`
        : unassigned
          ? "미분류 자산을 배정해 주세요."
          : "가격이 있는 자산을 등록해 주세요.";
    else if (impossibleWithoutSelling)
      advice = "목표 0% 자산이 있어 매수만으로 조정할 수 없습니다.";
    else if (!advice) {
      if (
        !needsAdjustment(
          bucket.targetPercent,
          current,
          targetTotal > 0 ? (current / targetTotal) * 100 : 0,
          plan.tolerancePercent,
        )
      )
        advice = "계산 기준 비중이 허용 오차 안에 있습니다.";
      else if (mode === "add-only" && fundedGapPercent < 0)
        advice = "매도하지 않고 현재 수량을 유지합니다.";
      else
        advice = (reasons.get(bucket.id) ?? ["매수 예산·후보 가격·주식 1주 단위를 확인하세요."]).join(" ");
    }
    return {
      bucket,
      current,
      currentPercent,
      gapPercent: bucket.targetPercent - currentPercent,
      fundedGapPercent,
      projectedPercent:
        projected.total > 0 ? (projectedValue / projected.total) * 100 : 0,
      remainingGapKrw,
      advice,
      separateReview: separate.length
        ? `${separate.join(" · ")}은 이번 주식 제안에 포함하지 않습니다.`
        : null,
    };
  });
  return {
    items,
    trades,
    candidates,
    ready,
    requiredCash: theoreticalCash,
    newCash: cash,
    buyBudget: mode === "add-only" ? cash : trades.reduce((sum, trade) => sum + (trade.side === "sell" ? trade.amountKrw : 0), 0),
    currentTotal: total,
    targetTotal,
    residualCash: available,
    projectedUnassignedPercent:
      targetTotal > 0 ? (available / targetTotal) * 100 : 0,
  };
}
