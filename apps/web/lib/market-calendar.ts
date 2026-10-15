import { unstable_cache } from "next/cache";
import { domesticTradingCalendar, kisConfigured } from "./kis";
import { parseKisTradingDay } from "../app/market-sessions";

// KIS requests at most once per date on cache hits across users/instances.
// No user/session data or credentials are part of the cached output.
const cachedDay = unstable_cache(async (date: string) => {
  const day = parseKisTradingDay(await domesticTradingCalendar(date),date);
  if (day === null) throw new Error("Calendar date missing");
  return day;
}, ["pf-kis-trading-day-v1", process.env.KIS_BASE_URL ?? "live"], {revalidate:false});
const pending = new Map<string, Promise<boolean | null>>();
let retryAfter = 0;
export async function domesticTradingDay(date: string): Promise<boolean | null> {
  if (!kisConfigured() || Date.now() < retryAfter) return null;
  const current = pending.get(date);
  if (current) return current;
  const request = cachedDay(date).catch(() => {
    retryAfter = Date.now()+5*60_000;
    return null;
  }).finally(() => pending.delete(date));
  pending.set(date,request);
  return request;
}
