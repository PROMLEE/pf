export type ReviewKind = "monthly" | "quarterly" | "threshold";
export type ReviewPreferences = {
  monthly: boolean;
  day: number;
  quarterly: boolean;
  threshold: boolean;
  nextMonthly: string | null;
  nextQuarterly: string | null;
  lastReviewed: string | null;
  observedAt: string | null;
  outside: boolean | null;
};
export const emptyReviewPreferences: ReviewPreferences = {
  monthly: false,
  day: 1,
  quarterly: false,
  threshold: false,
  nextMonthly: null,
  nextQuarterly: null,
  lastReviewed: null,
  observedAt: null,
  outside: null,
};
const koreaOffset = 9 * 3600_000;
export function reviewDate(now: Date) {
  return new Date(now.getTime() + koreaOffset).toISOString().slice(0, 10);
}
export function nextReview(
  kind: "monthly" | "quarterly",
  day: number,
  after: Date,
): string {
  const kst = new Date(after.getTime() + koreaOffset);
  for (let offset = 0; offset < 15; offset++) {
    const first = new Date(
      Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + offset, 1),
    );
    const month = first.getUTCMonth();
    if (kind === "quarterly" && ![2, 5, 8, 11].includes(month)) continue;
    // 09:00 Korea = 00:00 UTC. Month-end uses calendar days, not exchange sessions.
    const date =
      kind === "quarterly"
        ? new Date(Date.UTC(first.getUTCFullYear(), month + 1, 0))
        : new Date(Date.UTC(first.getUTCFullYear(), month, day));
    if (date.getTime() > after.getTime()) return date.toISOString();
  }
  throw new Error("Cannot determine next review");
}
export function reviewInput(
  value: unknown,
): {
  monthly: boolean;
  day: number;
  quarterly: boolean;
  threshold: boolean;
} | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    ["monthly", "quarterly", "threshold"].some(
      (key) => typeof v[key] !== "boolean",
    ) ||
    typeof v.day !== "number" ||
    !Number.isInteger(v.day) ||
    v.day < 1 ||
    v.day > 28
  )
    return null;
  return {
    monthly: v.monthly as boolean,
    quarterly: v.quarterly as boolean,
    threshold: v.threshold as boolean,
    day: v.day,
  };
}
export function reviewPayload(kind: ReviewKind, period: string) {
  const body =
    kind === "monthly"
      ? "이번 달 포트 비중을 점검해 보세요. 추가 투자금이 있다면 부족한 포트를 먼저 확인하세요."
      : kind === "quarterly"
        ? "분기 말 점검일입니다. 허용 범위 밖인 포트가 남아 있는지 확인해 보세요."
        : "최근 확인한 비중에서 허용 범위 밖인 포트가 있습니다. 최신 시세로 다시 확인해 보세요.";
  return {
    title: "PortRhythm · 포트폴리오 점검",
    body,
    url: "/?view=rebalance",
    tag: `pr-review-${kind}-${period}`,
  };
}
