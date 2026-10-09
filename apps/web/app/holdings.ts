export type Market = "KR" | "US";

export type Holding = {
  id: string;
  accountId?: string;
  broker: string;
  account: string;
  market: Market;
  name: string;
  symbol: string;
  exchange?: string | null;
  bucketId?: string | null;
  assignmentSource?: "auto" | "manual";
  quantity: number;
  capturedPrice: number | null;
  averageCost: number | null;
  capturedAt: string;
  currentPrice: number | null;
  quoteLabel: string | null;
  quoteCheckedAt: string | null;
};

export type RecognizedHolding = Pick<
  Holding,
  | "market"
  | "name"
  | "symbol"
  | "exchange"
  | "quantity"
  | "capturedPrice"
  | "averageCost"
>;

const knownKoreanSymbols: Record<string, string> = {
  SK하이닉스: "000660",
  현대차: "005380",
  삼성전자: "005930",
  "KODEX 200": "069500",
};

function number(raw: string): number | null {
  const parsed = Number(raw.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function capturedPrice(
  line: string,
  quantity: number,
  market: Market,
): number | null {
  const escapedQuantity = String(quantity).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const expression =
    market === "US"
      ? new RegExp(`(?:^|\\s)${escapedQuantity}\\s+(\\d+[.,]\\d{2,4})`)
      : /(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{4,})\s+\d{1,3}(?:,\d{3})+/;
  const match = line.match(expression);
  return match ? number(match[1]) : null;
}

function recognizeMiraeDomestic(lines: string[]): RecognizedHolding[] {
  const rows: RecognizedHolding[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const quantityLine = lines[i];
    if (!quantityLine.includes("국내주식")) continue;
    const quantity = number(quantityLine.match(/^([\d,]+)\s/)?.[1] ?? "");
    if (!quantity) continue;
    const details = lines[i - 1].match(
      /^(.*?)\s+[-+]?\d[\d,]*\s+([\d,]+)\s+현금$/,
    );
    if (!details) continue;
    const valuation = number(details[2]);
    if (!valuation) continue;
    const costRaw = quantityLine.match(
      /^([\d,]+)\s+[-+]?\d+(?:\.\d+)?\s+([\d,.]+)/,
    )?.[2];
    const costAmount = costRaw
      ? number(costRaw.replace(/^(\d{1,3})\.(\d{6})$/, "$1$2"))
      : null;
    let name = details[1].trim();
    if (name === "하이닉스") name = "SK하이닉스";
    if (name.includes("금현물")) name = "ACE KRX금현물";
    rows.push({
      market: "KR",
      name,
      symbol: knownKoreanSymbols[name] ?? "",
      quantity,
      capturedPrice: valuation / quantity,
      averageCost: costAmount === null ? null : costAmount / quantity,
    });
  }

  // The all-accounts view can list the same security more than once. Combine
  // only rows with a verified symbol; truncated names must remain separate.
  const merged: RecognizedHolding[] = [];
  for (const row of rows) {
    const existing = row.symbol
      ? merged.find((item) => item.symbol === row.symbol)
      : undefined;
    if (!existing) {
      merged.push(row);
      continue;
    }
    const totalValue =
      existing.quantity * (existing.capturedPrice ?? 0) +
      row.quantity * (row.capturedPrice ?? 0);
    const totalCost =
      existing.averageCost !== null && row.averageCost !== null
        ? existing.quantity * existing.averageCost +
          row.quantity * row.averageCost
        : null;
    existing.quantity += row.quantity;
    existing.capturedPrice = totalValue / existing.quantity;
    existing.averageCost =
      totalCost === null ? null : totalCost / existing.quantity;
  }
  return merged;
}

export function recognizeHoldings(
  text: string,
  market: Market,
): RecognizedHolding[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  if (market === "KR" && lines.some((line) => line.includes("미래에셋증권"))) {
    return recognizeMiraeDomestic(lines);
  }

  if (market === "US") {
    const rows: RecognizedHolding[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(/([A-Z]{2,5})\s+(\d{1,8})\s+\d+[.,]\d{2,4}/);
      if (!match) continue;
      if (!line.includes("현금") && !line.includes("%")) continue;
      const symbol = match[1];
      const quantity = number(match[2]);
      if (!quantity || ["HOME", "MY"].includes(symbol)) continue;
      const previous = lines[i - 1] ?? "";
      const name = previous
        .replace(/\s+\d{1,8}\s+\d+[.,]\d{2,4}.*$/, "")
        .trim();
      rows.push({
        market,
        symbol,
        name:
          name.length >= 3 && !name.includes("종목명") && !name.includes("현금")
            ? name
            : symbol,
        quantity,
        capturedPrice: capturedPrice(previous, quantity, market),
        averageCost: number(
          line.match(/\b[A-Z]{2,5}\s+\d{1,8}\s+(\d+[.,]\d{2,4})/)?.[1] ?? "",
        ),
      });
    }
    return rows;
  }

  const rows: RecognizedHolding[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/(?:^|\s)현금\s+(\d{1,8})\s+[\d,]+/);
    if (!match) continue;
    const quantity = number(match[1]);
    if (!quantity) continue;
    const previous = lines[i - 1] ?? "";
    const firstPrice = previous.search(/\s+\d{1,3}(?:,\d{3})+|\s+\d{4,}/);
    if (firstPrice < 0) continue;
    let name = previous.slice(0, firstPrice).trim();
    const beforePrevious = lines[i - 2] ?? "";
    if (
      name.length <= 2 &&
      beforePrevious &&
      !/(?:\d{1,3}(?:,\d{3})+|\d+\.\d{2,4})/.test(beforePrevious)
    ) {
      name = `${beforePrevious}${name}`;
    }
    if (!name || name.includes("종목명")) continue;
    rows.push({
      market,
      name,
      symbol: knownKoreanSymbols[name] ?? "",
      quantity,
      capturedPrice: capturedPrice(previous, quantity, market),
      averageCost: number(
        line.match(/(?:^|\s)현금\s+\d{1,8}\s+([\d,]+)/)?.[1] ?? "",
      ),
    });
  }
  return rows;
}

export function holdingKey(
  holding: Pick<Holding, "id" | "broker" | "account" | "market" | "symbol">,
) {
  return [
    holding.broker.trim().toLowerCase(),
    holding.account.trim().toLowerCase(),
    holding.market,
    (holding.symbol || holding.id).trim().toUpperCase(),
  ].join(":");
}
