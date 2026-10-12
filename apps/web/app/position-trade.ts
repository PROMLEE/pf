export type TradeSide = "buy" | "sell";
export type PositionTrade = {
  side: TradeSide;
  quantity: number;
  price: number;
  fee: number;
};
export type ExpectedPosition = {
  quantity: number;
  averageCost: number | null;
  market: "KR" | "US";
  symbol: string;
  accountId: string;
  revision: string;
};
export type HoldingTradeInput = PositionTrade & { expected: ExpectedPosition };
export class PositionTradeError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}
const number = (value: unknown, positive = true) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  (positive ? value > 0 : value >= 0) &&
  value < 1e12;
const shares = (value: unknown) =>
  number(value) &&
  (value as number) >= 0.000001 &&
  Math.abs((value as number) - Math.round((value as number) * 1e6) / 1e6) <=
    1e-9;
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function validateHoldingTrade(
  value: unknown,
): value is HoldingTradeInput {
  if (!value || typeof value !== "object") return false;
  const trade = value as HoldingTradeInput;
  const expected = trade.expected;
  return (
    (trade.side === "buy" || trade.side === "sell") &&
    shares(trade.quantity) &&
    number(trade.price) &&
    number(trade.fee, false) &&
    Boolean(
      expected &&
        typeof expected === "object" &&
        shares(expected.quantity) &&
        (expected.averageCost === null || number(expected.averageCost)) &&
        (expected.market === "KR" || expected.market === "US") &&
        typeof expected.symbol === "string" &&
        expected.symbol.length <= 20 &&
        uuid(expected.accountId) &&
        typeof expected.revision === "string" &&
        /^\d{1,20}$/.test(expected.revision),
    )
  );
}
export function calculatePositionTrade(
  current: { quantity: number; averageCost: number | null },
  trade: PositionTrade,
) {
  if (
    !shares(trade.quantity) ||
    !number(trade.price) ||
    !number(trade.fee, false) ||
    !["buy", "sell"].includes(trade.side)
  )
    throw new PositionTradeError(
      "거래 수량은 소수점 6자리까지, 거래 단가는 양수로 입력해 주세요.",
    );
  if (trade.side === "sell" && trade.quantity > current.quantity)
    throw new PositionTradeError("보유 수량보다 많이 매도할 수 없습니다.");
  if (
    trade.side === "buy" &&
    current.quantity > 0 &&
    current.averageCost === null
  )
    throw new PositionTradeError(
      "기존 평균 매입단가를 먼저 입력해야 추가 매수 평단을 계산할 수 있습니다.",
    );
  const quantity =
    Math.round(
      (current.quantity +
        (trade.side === "buy" ? trade.quantity : -trade.quantity)) *
        1e6,
    ) / 1e6;
  if (quantity >= 1e12)
    throw new PositionTradeError("변경 후 보유 수량이 입력 범위를 초과합니다.");
  const gross = trade.quantity * trade.price;
  const rawAverageCost =
    quantity === 0
      ? null
      : trade.side === "buy"
        ? (current.quantity * (current.averageCost ?? 0) + gross + trade.fee) /
          quantity
        : current.averageCost;
  const averageCost =
    rawAverageCost === null ? null : Math.round(rawAverageCost * 1e6) / 1e6;
  if (averageCost !== null && !number(averageCost))
    throw new PositionTradeError("변경 후 평균 매입단가를 확인해 주세요.");
  return {
    quantity,
    averageCost,
    gross,
    realisedGain:
      trade.side === "sell" && current.averageCost !== null
        ? (trade.price - current.averageCost) * trade.quantity - trade.fee
        : null,
  };
}
