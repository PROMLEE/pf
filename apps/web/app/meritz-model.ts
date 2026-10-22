export type MeritzPosition = {
  market: "KR" | "US";
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  price: number;
  exchange: string | null;
};
export type MeritzChange = {
  key: string;
  kind: "stock" | "cash";
  name: string;
  currency: "KRW" | "USD";
  id: string | null;
  before: number | null;
  after: number;
  beforeCost?: number | null;
  position?: MeritzPosition;
};
export type MeritzPreview = {
  token: string;
  accountName: string;
  fetchedAt: string;
  expiresAt: number;
  changes: MeritzChange[];
  unchanged: number;
  warnings: string[];
};
const numeric = (value: unknown) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === ""
  )
    throw Error("잔고 숫자를 확인할 수 없습니다.");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e12)
    throw Error("지원하지 않는 잔고 숫자입니다.");
  return n;
};
export function meritzPositions(
  domestic: Record<string, unknown>[],
  overseas: Record<string, unknown>[],
) {
  const positions: MeritzPosition[] = [],
    warnings: string[] = [];
  for (const row of domestic) {
    if (row.pros_trgt_cls_code !== "1") continue; // combined endpoint includes overseas holdings
    const symbol = String(row.iscd ?? "").replace(/^A(?=[0-9A-Z]{6}$)/, "");
    if (!/^[0-9A-Z]{6}$/.test(symbol)) {
      warnings.push(
        `${String(row.isnm || "국내 자산")}: 지원하지 않는 종목코드`,
      );
      continue;
    }
    const quantity = numeric(row.rmnd_qty);
    if (!quantity) continue;
    positions.push({
      market: "KR",
      symbol,
      name: String(row.isnm || symbol),
      quantity,
      averageCost: numeric(row.byng_unpr),
      price: numeric(row.psnt_prc),
      exchange: null,
    });
  }
  for (const row of overseas) {
    const symbol = String(row.ovrs_stck_symb_iscd ?? "");
    if (
      row.crcd !== "USD" ||
      row.rmnd_clcd === "3" ||
      !/^[A-Z.]{1,10}$/.test(symbol)
    ) {
      warnings.push(`${String(row.isnm || symbol)}: 지원하지 않는 해외 잔고`);
      continue;
    }
    const quantity = numeric(row.rmnd_dqty);
    if (!quantity) continue;
    if (Math.abs(quantity - Number(quantity.toFixed(6))) > 1e-10) {
      warnings.push(
        `${String(row.isnm || symbol)}: 소수점 6자리를 초과한 수량으로 제외`,
      );
      continue;
    }
    const suffix = String(row.iscd ?? "")
      .split(".")
      .at(-1);
    const exchange =
      suffix === "OQ"
        ? "NAS"
        : suffix === "N"
          ? "NYS"
          : suffix === "A"
            ? "AMS"
            : null;
    positions.push({
      market: "US",
      symbol,
      name: String(row.isnm || symbol),
      quantity,
      averageCost: numeric(row.avrg_unpr),
      price: numeric(row.psnt_prc),
      exchange,
    });
  }
  const counts = new Map<string, number>();
  for (const row of positions)
    counts.set(
      `${row.market}:${row.symbol}`,
      (counts.get(`${row.market}:${row.symbol}`) ?? 0) + 1,
    );
  // Loan/fractional/ordinary lots must not silently overwrite each other.
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([key]) => key);
  for (const key of duplicates)
    warnings.push(`${key}: 여러 잔고 구분으로 조회되어 이번 반영에서 제외`);
  return {
    positions: positions.filter(
      (p) => !duplicates.includes(`${p.market}:${p.symbol}`),
    ),
    warnings,
    excluded: duplicates,
  };
}
export const meritzNumber = numeric;
