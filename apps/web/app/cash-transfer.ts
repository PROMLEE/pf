export type CashMovementKind = "transfer" | "deposit" | "withdrawal";
export type CashTransferInput = {
  kind?: CashMovementKind;
  fxRate?: number | null;
  id: string;
  sourceId: string | null;
  destinationId: string | null;
  amount: number;
  note: string;
  expectedRevision: number;
};
export class CashTransferError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validCashTransfer(value: unknown): value is CashTransferInput {
  if (!value || typeof value !== "object") return false;
  const v = value as CashTransferInput;
  const kind = v.kind ?? "transfer";
  const validId = (id: unknown) => typeof id === "string" && uuid.test(id);
  const endpoints =
    kind === "transfer"
      ? validId(v.sourceId) &&
        validId(v.destinationId) &&
        v.sourceId !== v.destinationId
      : kind === "deposit"
        ? v.sourceId === null && validId(v.destinationId)
        : kind === "withdrawal"
          ? validId(v.sourceId) && v.destinationId === null
          : false;
  return (
    validId(v.id) &&
    endpoints &&
    (v.fxRate == null ||
      (kind === "deposit" &&
        typeof v.fxRate === "number" &&
        Number.isFinite(v.fxRate) &&
        Number(v.fxRate.toFixed(6)) === v.fxRate &&
        v.fxRate >= 100 &&
        v.fxRate <= 100000)) &&
    typeof v.amount === "number" &&
    Number.isFinite(v.amount) &&
    v.amount > 0 &&
    v.amount <= 1e15 &&
    typeof v.note === "string" &&
    v.note.length <= 200 &&
    Number.isSafeInteger(v.expectedRevision) &&
    v.expectedRevision >= 0
  );
}
function units(value: string) {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value))
    throw new CashTransferError("잔액 형식을 확인해 주세요.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
}
function decimal(value: bigint) {
  return `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`;
}
export function transferBalances(
  source: string,
  destination: string,
  amount: number,
  currency: "KRW" | "USD",
) {
  const precision = currency === "KRW" ? 0 : 2;
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > (currency === "USD" ? 1e12 : 1e15) ||
    Number(amount.toFixed(precision)) <= 0 ||
    Math.abs(amount - Number(amount.toFixed(precision))) > 1e-9
  )
    throw new CashTransferError(
      currency === "KRW"
        ? "원화 이체 금액은 1원 단위로 입력해 주세요."
        : "달러 이체 금액은 소수점 둘째 자리까지 입력해 주세요.",
    );
  const delta = units(amount.toFixed(precision)),
    a = units(source),
    b = units(destination);
  if (a < delta) throw new CashTransferError("출금할 현금 잔액이 부족합니다.");
  if (
    b + delta >
    units(currency === "USD" ? "1000000000000" : "1000000000000000")
  )
    throw new CashTransferError("입금 후 잔액이 입력 범위를 초과합니다.");
  return { source: decimal(a - delta), destination: decimal(b + delta) };
}
export function transferredFx(
  sourceRate: number | null,
  destinationRate: number | null,
  destinationBalance: number,
  amount: number,
) {
  if (
    sourceRate === null ||
    (destinationBalance > 0 && destinationRate === null)
  )
    return null;
  return (
    Math.round(
      ((destinationBalance * (destinationRate ?? 0) + amount * sourceRate) /
        (destinationBalance + amount)) *
        1e6,
    ) / 1e6
  );
}
