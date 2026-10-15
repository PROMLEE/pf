import type { Market } from "./holdings";

export type MarketSession = {
  date: string;
  status: "regular" | "closed" | "unknown";
};
export type MarketSessions = {
  KR: MarketSession;
  US: MarketSession;
  preferredMarket: Market | null;
  checkedAt: string;
  expiresAt: string;
};

// NYSE official 2026–2028 calendar; update before 2029. Unknown years never
// assert that an exchange is open. This is a schedule, not a halt/orderability feed.
// https://www.nyse.com/trade/hours-calendars
const usHolidays: Record<string, string[]> = {
  "2026": ["01-01", "01-19", "02-16", "04-03", "05-25", "06-19", "07-03", "09-07", "11-26", "12-25"],
  "2027": ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24"],
  "2028": ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25"],
};
const usEarlyClose = new Set(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);
const formatters = {
  KR: new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"}),
  US: new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"}),
};
export function marketLocalTime(now: Date, market: Market) {
  const parts = Object.fromEntries(formatters[market].formatToParts(now).map(part => [part.type,part.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`, minutes:Number(parts.hour)*60+Number(parts.minute), weekend:parts.weekday === "Sat" || parts.weekday === "Sun"};
}
export function parseKisTradingDay(output: unknown, date: string): boolean | null {
  const rows = Array.isArray(output) ? output : [output];
  const key = date.replaceAll("-", "");
  const row = rows.find(row => row && typeof row === "object" && row.bass_dt === key);
  return row?.opnd_yn === "Y" ? true : row?.opnd_yn === "N" ? false : null;
}
export function marketSessions(now: Date, domesticDay: boolean | null): MarketSessions {
  const kr = marketLocalTime(now,"KR");
  const us = marketLocalTime(now,"US");
  const holidays = usHolidays[us.date.slice(0,4)];
  const usHoliday = holidays?.includes(us.date.slice(5));
  const usClose = usEarlyClose.has(us.date) ? 13*60 : 16*60;
  const US: MarketSession = {date:us.date,status:us.weekend || usHoliday || us.minutes < 9*60+30 || us.minutes >= usClose ? "closed" : holidays ? "regular" : "unknown"};
  // KIS confirms trading dates, not exceptional session hours (e.g. CSAT).
  const KR: MarketSession = {date:kr.date,status:kr.weekend || domesticDay === false || kr.minutes < 9*60 || kr.minutes >= 15*60+30 ? "closed" : domesticDay === true ? "regular" : "unknown"};
  return {KR,US,preferredMarket:KR.status === "regular" && US.status !== "regular" ? "KR" : US.status === "regular" && KR.status !== "regular" ? "US" : null,checkedAt:now.toISOString(),expiresAt:new Date(now.getTime()+90_000).toISOString()};
}
