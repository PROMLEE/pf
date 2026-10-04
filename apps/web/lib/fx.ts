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
