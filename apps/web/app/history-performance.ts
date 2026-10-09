import type { CashFlow, Snapshot } from "./portfolio-model";

/** Flow occurrence is separate from when a user entered the record. */
export function historyPerformance(points: Snapshot[], flows: CashFlow[]) {
  const ordered = [...points].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.recordedAt ? Date.parse(a.recordedAt) : -Infinity) -
        (b.recordedAt ? Date.parse(b.recordedAt) : -Infinity) ||
      0,
  );
  const first = ordered[0],
    last = ordered.at(-1);
  if (!first || !last || first === last)
    return {
      first,
      last,
      change: null,
      netFlow: 0,
      adjusted: null,
      ambiguous: [] as CashFlow[],
    };
  let netFlow = 0;
  const ambiguous: CashFlow[] = [];
  for (const flow of flows) {
    if (flow.deletedAt) continue;
    if (flow.date < first.date || flow.date > last.date) continue;
    if (flow.occurredAt && first.recordedAt && last.recordedAt) {
      const at = Date.parse(flow.occurredAt);
      if (
        at > Date.parse(first.recordedAt) &&
        at <= Date.parse(last.recordedAt)
      )
        netFlow += flow.amountKrw;
    } else if (flow.date > first.date && flow.date < last.date) {
      netFlow += flow.amountKrw;
    } else {
      // Unknown time on either boundary day must never silently become a return.
      ambiguous.push(flow);
    }
  }
  const change = last.valueKrw - first.valueKrw;
  return {
    first,
    last,
    change,
    netFlow,
    adjusted: ambiguous.length ? null : change - netFlow,
    ambiguous,
  };
}

export function kstTime(value: string, seconds = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  }).format(new Date(value));
}
export function kstDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

/** Daily chart summaries and their calculation interval use the same endpoints. */
export function dailyObservations(points: Snapshot[]) {
  const ordered = [...points].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.recordedAt ? Date.parse(a.recordedAt) : -Infinity) -
        (b.recordedAt ? Date.parse(b.recordedAt) : -Infinity) ||
      0,
  );
  const days = new Map<string, Snapshot>();
  for (const point of ordered) days.set(point.date, point);
  return [...days.values()];
}
