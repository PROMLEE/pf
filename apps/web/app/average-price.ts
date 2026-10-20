export type AveragePriceMode = "quantity" | "budget" | "target";
export type AveragePriceInput = {
  quantity: number;
  averagePrice: number;
  buyPrice: number;
  mode: AveragePriceMode;
  amount: number;
  fractional: boolean;
};

/** Buy only complete tradable lots without crossing the selected currency balance. */
export function purchaseWithinBudget(
  budget: number,
  price: number,
  fractional: boolean,
) {
  if (
    !Number.isFinite(budget) ||
    budget < 0 ||
    budget > 1e15 ||
    !Number.isFinite(price) ||
    price <= 0
  )
    throw new Error("현금 잔고와 추가 매수 단가를 확인하세요.");
  const scale = fractional ? 1e8 : 1;
  const lots = (budget / price) * scale;
  if (
    !Number.isFinite(lots) ||
    lots > Number.MAX_SAFE_INTEGER ||
    lots / scale > 1e12
  )
    throw new Error("계산 가능한 금액 또는 수량 범위를 초과했습니다.");
  const nearest = Math.round(lots);
  const normalized =
    Math.abs(lots - nearest) <= Number.EPSILON * Math.max(1, Math.abs(lots)) * 4
      ? nearest
      : lots;
  let quantity = Math.floor(normalized) / scale;
  const epsilon = Number.EPSILON * Math.max(1, budget) * 4;
  if (quantity * price - budget > epsilon)
    quantity = Math.max(0, (Math.round(quantity * scale) - 1) / scale);
  const cost = Math.min(budget, quantity * price);
  return { quantity, cost, remaining: Math.max(0, budget - cost) };
}

/** A local simulation only. Costs are in one currency; fees and FX are excluded. */
export function calculateAveragePrice(input: AveragePriceInput) {
  const { quantity, averagePrice, buyPrice, amount, mode, fractional } = input;
  if (
    ![quantity, averagePrice, buyPrice, amount].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error("수량과 가격은 0보다 큰 숫자로 입력하세요.");
  if (!["quantity", "budget", "target"].includes(mode))
    throw new Error("계산 방식을 확인하세요.");
  const scale = fractional ? 1e8 : 1;
  const existingCost = quantity * averagePrice;
  const budget =
    mode === "budget"
      ? purchaseWithinBudget(amount, buyPrice, fractional)
      : null;
  let rawQuantity = budget?.quantity ?? amount;
  if (mode === "target") {
    if (
      amount <= Math.min(averagePrice, buyPrice) ||
      amount >= Math.max(averagePrice, buyPrice)
    )
      throw new Error(
        "목표 평단가는 기존 평단가와 추가 매수 단가 사이로 입력하세요.",
      );
    rawQuantity = (quantity * (averagePrice - amount)) / (amount - buyPrice);
  }
  const lots = rawQuantity * scale;
  if (
    quantity > 1e12 ||
    !Number.isFinite(lots) ||
    lots > Number.MAX_SAFE_INTEGER ||
    existingCost > 1e15
  )
    throw new Error("계산 가능한 금액 또는 수량 범위를 초과했습니다.");
  const nearest = Math.round(lots);
  // Remove only floating-point noise at a lot boundary, not real fractions.
  const normalized =
    Math.abs(lots - nearest) <= Number.EPSILON * Math.max(1, Math.abs(lots)) * 4
      ? nearest
      : lots;
  if (mode === "quantity" && (normalized !== nearest || nearest < 1))
    throw new Error(
      fractional
        ? "수량은 소수점 8자리까지 입력하세요."
        : "주식 수량은 1주 단위로 입력하거나 소수점 거래를 선택하세요.",
    );
  const additionalQuantity =
    budget?.quantity ??
    (mode === "target"
      ? Math.max(1, Math.ceil(normalized))
      : Math.floor(normalized)) / scale;
  const additionalCost = budget?.cost ?? additionalQuantity * buyPrice;
  const totalQuantity = quantity + additionalQuantity;
  const totalCost = existingCost + additionalCost;
  if (!Number.isFinite(totalCost) || totalCost > 1e15 || totalQuantity > 1e12)
    throw new Error("계산 가능한 금액 또는 수량 범위를 초과했습니다.");
  const nextAverage = totalCost / totalQuantity;
  return {
    additionalQuantity,
    additionalCost,
    totalQuantity,
    totalCost,
    existingCost,
    averagePrice: nextAverage,
    changePercent: (nextAverage / averagePrice - 1) * 100,
    beforeGainPercent: (buyPrice / averagePrice - 1) * 100,
    afterGainPercent: (buyPrice / nextAverage - 1) * 100,
    remainingBudget:
      mode === "budget" ? Math.max(0, amount - additionalCost) : null,
  };
}
