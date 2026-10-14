export type UsdKrwReference = {
  rate: number;
  date: string;
};

export async function fetchUsdKrwReference(): Promise<UsdKrwReference> {
  const response = await fetch(
    "https://api.frankfurter.dev/v2/providers/ecb/rate/usd/krw",
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error("기준 환율을 가져오지 못했습니다.");
  const payload = (await response.json()) as Record<string, unknown>;
  if (
    payload.base !== "USD" ||
    payload.quote !== "KRW" ||
    typeof payload.rate !== "number" ||
    !Number.isFinite(payload.rate) ||
    payload.rate < 100 ||
    payload.rate > 100000 ||
    typeof payload.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
    Number.isNaN(Date.parse(`${payload.date}T00:00:00Z`)) ||
    Date.parse(`${payload.date}T00:00:00Z`) > Date.now()
  )
    throw new Error("기준 환율 응답을 확인할 수 없습니다.");
  return { rate: payload.rate, date: payload.date };
}
export async function fetchPreviousUsdKrw(
  date: string,
): Promise<number | null> {
  const end = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return null;
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 14);
  const response = await fetch(
    `https://api.frankfurter.dev/v2/providers/ecb/rates?base=USD&quotes=KRW&from=${start.toISOString().slice(0, 10)}&to=${end.toISOString().slice(0, 10)}`,
    { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) throw new Error("전일 기준환율 조회 실패");
  const rows = await response.json();
  if (!Array.isArray(rows)) return null;
  const valid = rows
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        row.base === "USD" &&
        row.quote === "KRW" &&
        typeof row.date === "string" &&
        row.date < date &&
        row.date >= start.toISOString().slice(0, 10) &&
        Number.isFinite(Date.parse(`${row.date}T00:00:00Z`)) &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        typeof row.rate === "number" &&
        Number.isFinite(row.rate) &&
        row.rate >= 100 &&
        row.rate <= 100000,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return valid[0]?.rate ?? null;
}
