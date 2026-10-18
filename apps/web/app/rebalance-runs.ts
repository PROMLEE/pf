import type { Holding, Market } from "./holdings";
import {
  portfolioValues,
  holdingBucketId,
  type Portfolio,
} from "./portfolio-model";
import { rebalance, type RebalanceMode } from "./rebalance";
import { calculatePositionTrade, type PositionTrade } from "./position-trade";

export type RunConfig = {
  mode: RebalanceMode;
  newCash: number | null;
  cashBucketId: string;
  preferredMarket: Market | null;
  candidatePolicy: "priority" | "fallback";
  excludedHoldingIds: string[];
  excludedBuySymbols: string[];
  buyRuleIds: Record<string, string>;
  sellSymbols: Record<string, string>;
  cryptoAssetIds: Record<string, string>;
  buyHoldingIds: Record<string, string>;
};
export type RunItem = {
  id: string;
  kind: "stock" | "crypto";
  bucketId: string;
  bucketName: string;
  side: "buy" | "sell";
  name: string;
  symbol: string;
  market: Market;
  holdingId: string | null;
  assetId: string | null;
  accountId: string | null;
  account: string | null;
  broker: string | null;
  exchange: string | null;
  quantity: number;
  unitPrice: number;
  currency: "KRW" | "USD";
  amountKrw: number;
  budgetKrw?: number;
};
export type RunWeights = {
  id: string;
  name: string;
  color: string;
  targetPercent: number;
  value: number;
  percent: number;
};
export type RunSnapshot = {
  title: string;
  config: RunConfig;
  usdKrw: number;
  newCash: number;
  currentTotal: number;
  targetTotal: number;
  toleranceMode: "percentage-points" | "relative";
  tolerance: number;
  before: RunWeights[];
  projected: RunWeights[];
  items: RunItem[];
  changes?: RunChange[];
};
export type RunFill = {
  id: string;
  itemId: string;
  holdingId: string | null;
  quantity: number;
  price: number;
  fee: number;
  currency: "KRW" | "USD";
  fxRate: number;
  createdAt: string;
  source: "plan" | "holding-editor";
};
export type RunOutcome = {
  total: number;
  weights: RunWeights[];
  capturedAt: string;
  configurationChanged: boolean;
};
export type RebalanceRun = {
  id: string;
  status: "active" | "completed" | "cancelled";
  revision: number;
  createdAt: string;
  endedAt: string | null;
  snapshot: RunSnapshot;
  fills: RunFill[];
  outcome: RunOutcome | null;
};
export class RunError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}
export const isRunId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
export function validRunConfig(value: unknown): value is RunConfig {
  if (!value || typeof value !== "object") return false;
  const c = value as RunConfig;
  const ids = (v: unknown) =>
    Array.isArray(v) && v.length <= 500 && v.every(isRunId);
  const map = (v: unknown, keysOnly = false) =>
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.entries(v).length <= 100 &&
    Object.entries(v).every(
      ([key, val]) =>
        isRunId(key) &&
        (keysOnly
          ? typeof val === "string" && val.length <= 100
          : val === "" || isRunId(val)),
    );
  return (
    (c.mode === "trade" || c.mode === "add-only") &&
    (c.newCash === null || finite(c.newCash, 0, 1e15)) &&
    (c.cashBucketId === "" || isRunId(c.cashBucketId)) &&
    [null, "KR", "US"].includes(c.preferredMarket) &&
    ["priority", "fallback"].includes(c.candidatePolicy) &&
    ids(c.excludedHoldingIds) &&
    Array.isArray(c.excludedBuySymbols) &&
    c.excludedBuySymbols.length <= 500 &&
    c.excludedBuySymbols.every(
      (v) => typeof v === "string" && /^(KR|US):[A-Z0-9.]{1,20}$/.test(v),
    ) &&
    Boolean(
      map(c.buyRuleIds) &&
        map(c.sellSymbols, true) &&
        map(c.cryptoAssetIds) &&
        map(c.buyHoldingIds),
    )
  );
}
export function freezeRunSnapshot(
  plan: Portfolio,
  holdings: Holding[],
  config: RunConfig,
  ids: () => string,
): RunSnapshot {
  if (
    Math.abs(plan.buckets.reduce((sum, b) => sum + b.targetPercent, 0) - 100) >
    1e-7
  )
    throw new RunError("목표 비중 합계를 100%로 맞춰 주세요.");
  const advice = rebalance(
    plan,
    holdings,
    config.mode,
    config.newCash,
    new Set(config.excludedHoldingIds),
    {
      ...config,
      excludedBuySymbols: new Set(config.excludedBuySymbols),
      requireSelection: true,
      autoOutsideTolerance: true,
    },
  );
  if (!advice.ready)
    throw new RunError("가격 확인과 자산 배정을 먼저 완료해 주세요.");
  const items: RunItem[] = [
    ...advice.trades.map((t) => {
      const held = holdings.find((h) => h.id === t.holdingId);
      const rule = plan.rules.find((r) => r.id === t.ruleId);
      return {
        id: ids(),
        kind: "stock" as const,
        bucketId: t.bucketId,
        bucketName: plan.buckets.find((b) => b.id === t.bucketId)!.name,
        side: t.side,
        name: t.name,
        symbol: t.symbol,
        market: t.market,
        holdingId: t.holdingId,
        assetId: null,
        accountId: held?.accountId ?? null,
        account: t.account,
        broker: t.broker,
        exchange: held?.exchange ?? rule?.exchange ?? null,
        quantity: t.shares,
        unitPrice: t.unitPrice,
        currency: t.currency,
        amountKrw: t.amountKrw,
      };
    }),
    ...advice.cryptoTrades.map((t) => ({
      id: ids(),
      kind: "crypto" as const,
      bucketId: t.bucketId,
      bucketName: plan.buckets.find((b) => b.id === t.bucketId)!.name,
      side: t.side,
      name: t.name,
      symbol: t.marketCode,
      market: "KR" as const,
      holdingId: null,
      assetId: t.assetId,
      accountId: null,
      account: null,
      broker: null,
      exchange: null,
      quantity: t.quantity,
      unitPrice: t.unitKrw,
      currency: "KRW" as const,
      amountKrw: t.amountKrw,
    })),
  ];
  if (!items.length) throw new RunError("확정할 매수·매도 제안이 없습니다.");
  if (items.length > 500)
    throw new RunError("한 계획은 거래 500건까지 지원합니다.");
  return {
    title: plan.title,
    config,
    usdKrw: plan.usdKrw,
    newCash: advice.newCash,
    currentTotal: advice.currentTotal,
    targetTotal: advice.targetTotal,
    toleranceMode: plan.toleranceMode ?? "percentage-points",
    tolerance:
      plan.toleranceMode === "relative"
        ? (plan.relativeTolerancePercent ?? 10)
        : plan.tolerancePercent,
    before: advice.items.map((i) => ({
      ...i.bucket,
      value: i.current,
      percent: i.currentPercent,
    })),
    projected: advice.items.map((i) => ({
      ...i.bucket,
      value: i.projectedValue,
      percent: i.projectedPercent,
    })),
    items,
  };
}
export function runItemProgress(item: RunItem, fills: RunFill[]) {
  const scale = item.kind === "crypto" ? 1e8 : 1e6;
  const executed =
    Math.round(
      fills
        .filter((f) => f.itemId === item.id)
        .reduce((n, f) => n + f.quantity, 0) * scale,
    ) / scale;
  const remaining = Math.max(
    0,
    Math.round((item.quantity - executed) * scale) / scale,
  );
  return { executed, remaining, done: remaining === 0 };
}
export function captureRunOutcome(
  snapshot: RunSnapshot,
  portfolio: Portfolio,
  holdings: Holding[],
): RunOutcome {
  const values = portfolioValues(portfolio, holdings);
  return {
    total: values.total,
    capturedAt: new Date().toISOString(),
    configurationChanged:
      snapshot.before.some(
        (old) =>
          portfolio.buckets.find((b) => b.id === old.id)?.targetPercent !==
          old.targetPercent,
      ) ||
      snapshot.before.length !== portfolio.buckets.length ||
      snapshot.items.some((item) => {
        if (item.kind === "stock" && item.holdingId) {
          const h = holdings.find((h) => h.id === item.holdingId);
          return Boolean(
            h &&
              (holdingBucketId(portfolio, h) !== item.bucketId ||
                h.accountId !== item.accountId),
          );
        }
        if (item.kind === "crypto") {
          const c = portfolio.cryptoAssets.find((c) => c.id === item.assetId);
          return Boolean(c && c.bucketId !== item.bucketId);
        }
        return false;
      }),
    weights: snapshot.before.map((b) => ({
      ...b,
      value: values.values.get(b.id) ?? 0,
      percent:
        values.total > 0
          ? ((values.values.get(b.id) ?? 0) / values.total) * 100
          : 0,
    })),
  };
}
export type RunExecution = {
  requestId: string;
  runId: string;
  itemId: string;
  revision: number;
  quantity: number;
  price: number;
  fee: number;
  fxRate: number;
  expectedQuantity: number;
  expectedRevision?: string;
  accountId: string | null;
  cash: { assetId: string; expectedBalance: number } | null;
};
export function validRunExecution(value: unknown): value is RunExecution {
  if (!value || typeof value !== "object") return false;
  const v = value as RunExecution;
  return (
    isRunId(v.requestId) &&
    isRunId(v.runId) &&
    isRunId(v.itemId) &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 0 &&
    finite(v.quantity, 1e-8, 1e11) &&
    finite(v.price, 1e-8, 1e11) &&
    finite(v.fee, 0, 1e11) &&
    finite(v.fxRate, 100, 100000) &&
    finite(v.expectedQuantity, 0, 1e11) &&
    (v.expectedRevision === undefined ||
      /^\d{1,20}$/.test(v.expectedRevision)) &&
    (v.accountId === null || isRunId(v.accountId)) &&
    (v.cash === null ||
      Boolean(
        v.cash &&
          isRunId(v.cash.assetId) &&
          finite(v.cash.expectedBalance, 0, 1e15),
      ))
  );
}
export function calculateRunPosition(
  item: Pick<RunItem, "kind">,
  current: { quantity: number; averageCost: number | null },
  trade: PositionTrade,
) {
  if (item.kind === "stock") return calculatePositionTrade(current, trade);
  const scale = 1e8;
  if (
    !finite(trade.quantity, 1e-8, 1e11) ||
    Math.abs(trade.quantity - Math.round(trade.quantity * scale) / scale) >
      1e-12 ||
    !finite(trade.price, 1e-8, 1e11) ||
    !finite(trade.fee, 0, 1e11)
  )
    throw new RunError(
      "가상자산 수량은 소수점 8자리까지, 단가는 양수로 입력하세요.",
    );
  if (trade.side === "sell" && trade.quantity > current.quantity)
    throw new RunError("보유 수량보다 많이 매도할 수 없습니다.");
  if (
    trade.side === "buy" &&
    current.quantity > 0 &&
    current.averageCost === null
  )
    throw new RunError("기존 평균 매입단가를 먼저 입력해 주세요.");
  const quantity =
    Math.round(
      (current.quantity + (trade.side === "buy" ? 1 : -1) * trade.quantity) *
        scale,
    ) / scale;
  const averageCost =
    quantity === 0
      ? null
      : trade.side === "buy"
        ? (current.quantity * (current.averageCost ?? 0) +
            trade.quantity * trade.price +
            trade.fee) /
          quantity
        : current.averageCost;
  if (
    !finite(quantity, 0, 1e11) ||
    (averageCost !== null && !finite(averageCost, 1e-8, 1e12))
  )
    throw new RunError("변경 후 보유 정보가 입력 범위를 초과합니다.");
  return { quantity, averageCost };
}

export type RunChange = {
  id: string;
  createdAt: string;
  from: RunItem;
  to: RunItem;
  executedQuantity: number;
  selection: string;
};
export type RunReplacement = {
  changeId: string;
  runId: string;
  revision: number;
  itemId: string;
  selection: string;
  expectedQuantity: number;
  expectedPrice: number;
};
export function validRunReplacement(value: unknown): value is RunReplacement {
  if (!value || typeof value !== "object") return false;
  const v = value as RunReplacement;
  return (
    isRunId(v.changeId) &&
    isRunId(v.runId) &&
    isRunId(v.itemId) &&
    finite(v.expectedQuantity, 1e-8, 1e11) &&
    finite(v.expectedPrice, 1e-8, 1e11) &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 0 &&
    typeof v.selection === "string" &&
    /^(holding|rule|crypto):[0-9a-f-]{36}$/i.test(v.selection) &&
    isRunId(v.selection.split(":")[1])
  );
}
export type RunChoice = {
  key: string;
  label: string;
  item: RunItem;
  available: number;
};
/** Choices come only from the owner's current holdings, registered candidates and coins. */
export function runReplacementChoices(
  run: RebalanceRun,
  item: RunItem,
  plan: Portfolio,
  holdings: Holding[],
): RunChoice[] {
  if (!plan.buckets.some((b) => b.id === item.bucketId)) return [];
  const base = {
    bucketId: item.bucketId,
    bucketName: item.bucketName,
    side: item.side,
    id: "",
  };
  const choices: RunChoice[] = [];
  const reserved = (holdingId: string | null, assetId: string | null) =>
    run.snapshot.items
      .filter(
        (i) =>
          i.id !== item.id &&
          i.side === "sell" &&
          (holdingId
            ? i.holdingId === holdingId ||
              run.fills.some(
                (f) => f.itemId === i.id && f.holdingId === holdingId,
              )
            : i.assetId === assetId),
      )
      .reduce((n, i) => n + runItemProgress(i, run.fills).remaining, 0);
  for (const h of holdings) {
    if (holdingBucketId(plan, h) !== item.bucketId || !h.accountId || !h.symbol)
      continue;
    if (
      item.side === "sell" &&
      run.snapshot.config.excludedHoldingIds.includes(h.id)
    )
      continue;
    if (
      item.side === "buy" &&
      run.snapshot.config.excludedBuySymbols.includes(`${h.market}:${h.symbol}`)
    )
      continue;
    const price = h.currentPrice ?? h.capturedPrice;
    if (!price || !Number.isFinite(price) || price <= 0) continue;
    choices.push({
      key: `holding:${h.id}`,
      label: `${h.name} · ${h.broker} ${h.account}`,
      available: Math.max(0, h.quantity - reserved(h.id, null)),
      item: {
        ...base,
        kind: "stock",
        name: h.name,
        symbol: h.symbol,
        market: h.market,
        holdingId: h.id,
        assetId: null,
        accountId: h.accountId,
        account: h.account,
        broker: h.broker,
        exchange: h.exchange ?? null,
        unitPrice: price,
        quantity: 0,
        currency: h.market === "US" ? "USD" : "KRW",
        amountKrw: 0,
      },
    });
  }
  if (item.side === "buy")
    for (const r of plan.rules) {
      if (
        r.bucketId !== item.bucketId ||
        run.snapshot.config.excludedBuySymbols.includes(
          `${r.market}:${r.symbol}`,
        )
      )
        continue;
      const price = r.quotedPrice ?? r.manualPrice;
      if (!price || !Number.isFinite(price) || price <= 0) continue;
      choices.push({
        key: `rule:${r.id}`,
        label: `${r.name} · 매수 후보 / 거래 계좌 선택`,
        available: Infinity,
        item: {
          ...base,
          kind: "stock",
          name: r.name,
          symbol: r.symbol,
          market: r.market,
          holdingId: null,
          assetId: null,
          accountId: null,
          account: null,
          broker: null,
          exchange: r.exchange,
          unitPrice: price,
          quantity: 0,
          currency: r.market === "US" ? "USD" : "KRW",
          amountKrw: 0,
        },
      });
    }
  for (const c of plan.cryptoAssets) {
    if (
      c.bucketId !== item.bucketId ||
      !c.quotedPriceKrw ||
      !Number.isFinite(c.quotedPriceKrw) ||
      c.quotedPriceKrw <= 0
    )
      continue;
    choices.push({
      key: `crypto:${c.id}`,
      label: `${c.name} · 가상자산`,
      available: Math.max(0, c.quantity - reserved(null, c.id)),
      item: {
        ...base,
        kind: "crypto",
        name: c.name,
        symbol: c.marketCode,
        market: "KR",
        holdingId: null,
        assetId: c.id,
        accountId: null,
        account: null,
        broker: null,
        exchange: null,
        unitPrice: c.quotedPriceKrw,
        quantity: 0,
        currency: "KRW",
        amountKrw: 0,
      },
    });
  }
  return choices.filter((c) => item.side === "buy" || c.available > 0);
}
export function previewRunReplacement(
  run: RebalanceRun,
  itemId: string,
  selection: string,
  plan: Portfolio,
  holdings: Holding[],
) {
  if (run.status !== "active")
    throw new RunError("진행 중인 계획에서만 변경할 수 있습니다.", 409);
  const from = run.snapshot.items.find((i) => i.id === itemId);
  if (!from) throw new RunError("변경할 거래를 찾지 못했습니다.", 404);
  const progress = runItemProgress(from, run.fills);
  if (progress.done)
    throw new RunError("완료한 거래는 변경할 수 없습니다.", 409);
  const choice = runReplacementChoices(run, from, plan, holdings).find(
    (c) => c.key === selection,
  );
  if (!choice)
    throw new RunError("같은 포트의 보유 종목 또는 매수 후보를 선택해 주세요.");
  const oldRemaining = (from.amountKrw * progress.remaining) / from.quantity;
  const budget = Math.max(
    0,
    (from.budgetKrw ?? from.amountKrw) -
      (from.amountKrw * progress.executed) / from.quantity,
  );
  const unitKrw =
    choice.item.unitPrice *
    (choice.item.currency === "USD" ? run.snapshot.usdKrw : 1);
  const scale = choice.item.kind === "crypto" ? 1e8 : 1;
  const quantity =
    Math.floor(
      Math.min(
        budget / unitKrw,
        from.side === "sell" ? choice.available : Infinity,
      ) *
        scale +
        1e-7,
    ) / scale;
  if (!(quantity > 0) || quantity > 1e11)
    throw new RunError(
      "남은 계획 금액으로 거래할 수 있는 수량이 없습니다. 다른 종목을 선택하세요.",
    );
  const to = {
    ...choice.item,
    quantity,
    amountKrw: quantity * unitKrw,
    budgetKrw: budget,
  };
  const unused = Math.max(0, budget - to.amountKrw);
  const cashProjection = run.snapshot.projected.find(
    (b) => b.id === run.snapshot.config.cashBucketId,
  );
  const availableCash = Math.max(
    0,
    cashProjection?.value ??
      run.snapshot.targetTotal -
        run.snapshot.projected.reduce((n, b) => n + b.value, 0),
  );
  return {
    from,
    to,
    budget,
    executedQuantity: progress.executed,
    unused,
    fundingShortfall: Math.max(
      0,
      (from.side === "sell"
        ? oldRemaining - to.amountKrw
        : to.amountKrw - oldRemaining) - availableCash,
    ),
  };
}
export function replaceRunItem(
  run: RebalanceRun,
  input: RunReplacement,
  plan: Portfolio,
  holdings: Holding[],
  newItemId: string,
  createdAt: string,
): RunSnapshot {
  if ((run.snapshot.changes?.length ?? 0) >= 100)
    throw new RunError("한 계획에서 종목 변경은 100회까지 지원합니다.");
  const { from, to, executedQuantity, fundingShortfall } =
    previewRunReplacement(run, input.itemId, input.selection, plan, holdings);
  if (fundingShortfall > 1e-6)
    throw new RunError(
      "변경 후 다른 매수 계획의 예산을 충당할 수 없습니다. 다른 종목을 선택하거나 새 계획으로 조정하세요.",
    );
  if (
    Math.abs(to.quantity - input.expectedQuantity) > 1e-10 ||
    to.unitPrice !== input.expectedPrice
  )
    throw new RunError(
      "시세나 보유 수량이 변경되었습니다. 새로고침 후 변경 수량을 다시 확인하세요.",
      409,
    );
  to.id = newItemId;
  const retained =
    executedQuantity > 0
      ? [
          {
            ...from,
            quantity: executedQuantity,
            amountKrw: (from.amountKrw * executedQuantity) / from.quantity,
            budgetKrw: (from.amountKrw * executedQuantity) / from.quantity,
          },
        ]
      : [];
  const items = run.snapshot.items.flatMap((i) =>
    i.id === from.id ? [...retained, to] : [i],
  );
  if (items.length > 500)
    throw new RunError("한 계획은 거래 500건까지 지원합니다.");
  const oldRemaining =
    (from.amountKrw * (from.quantity - executedQuantity)) / from.quantity;
  const delta = (to.amountKrw - oldRemaining) * (from.side === "buy" ? 1 : -1);
  const projected = run.snapshot.projected.map((b) => {
    const value =
      b.value +
      (b.id === from.bucketId ? delta : 0) -
      (b.id === run.snapshot.config.cashBucketId ? delta : 0);
    return {
      ...b,
      value,
      percent:
        run.snapshot.targetTotal > 0
          ? (value / run.snapshot.targetTotal) * 100
          : 0,
    };
  });
  return {
    ...run.snapshot,
    items,
    projected,
    changes: [
      ...(run.snapshot.changes ?? []),
      {
        id: input.changeId,
        createdAt,
        from,
        to,
        executedQuantity,
        selection: input.selection,
      },
    ],
  };
}
export function runPortfolioOverview(
  run: RebalanceRun,
  plan: Portfolio,
  holdings: Holding[],
) {
  const actual = portfolioValues(plan, holdings);
  return run.snapshot.before.map((b) => {
    const items = run.snapshot.items.filter((i) => i.bucketId === b.id);
    const pending = items.some((i) => !runItemProgress(i, run.fills).done);
    const current =
      actual.total > 0
        ? ((actual.values.get(b.id) ?? 0) / actual.total) * 100
        : 0;
    const projected =
      run.snapshot.projected.find((p) => p.id === b.id)?.percent ?? b.percent;
    const tolerance =
      run.snapshot.toleranceMode === "relative"
        ? (b.targetPercent * run.snapshot.tolerance) / 100
        : run.snapshot.tolerance;
    const within = Math.abs(projected - b.targetPercent) <= tolerance + 1e-9;
    const cash = b.id === run.snapshot.config.cashBucketId;
    const message = pending
      ? "남은 거래 진행 중"
      : items.length
        ? "거래 반영 완료 · 추가 제안 없음"
        : cash
          ? "다른 포트의 매수·매도 후 현금 잔액으로 조정"
          : within
            ? "계획 예상 비중이 허용 범위 안 · 거래 없음"
            : "이번 계획에 거래 없음 · 후보·거래 제외 설정 확인";
    return { ...b, current, projected, pending, within, message };
  });
}
