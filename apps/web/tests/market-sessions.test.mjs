import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compiled=ts.transpileModule(await readFile(new URL("../app/market-sessions.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {marketSessions,marketLocalTime,parseKisTradingDay}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const sessions=(date,day=true)=>marketSessions(new Date(date),day);
test("domestic regular session uses Seoul time and exact open/close boundaries",()=>{
  assert.equal(sessions("2026-10-15T23:59:00Z").KR.status,"closed");
  assert.equal(sessions("2026-10-16T00:00:00Z").preferredMarket,"KR");
  assert.equal(sessions("2026-10-16T06:29:59Z").KR.status,"regular");
  assert.equal(sessions("2026-10-16T06:30:00Z").KR.status,"closed");
});
test("domestic weekends, holiday metadata and failed calendar checks never assert an open session",()=>{
  assert.equal(sessions("2026-10-17T01:00:00Z").KR.status,"closed");
  assert.equal(sessions("2026-10-09T01:00:00Z",false).KR.status,"closed");
  const failed=sessions("2026-10-16T01:00:00Z",null);
  assert.equal(failed.KR.status,"unknown");assert.equal(failed.preferredMarket,null);
});
test("US opening automatically follows New York summer and winter offsets",()=>{
  assert.equal(sessions("2026-07-06T13:29:00Z").US.status,"closed");
  assert.equal(sessions("2026-07-06T13:30:00Z").preferredMarket,"US");
  assert.equal(sessions("2026-11-02T13:30:00Z").US.status,"closed");
  assert.equal(sessions("2026-11-02T14:30:00Z").preferredMarket,"US");
  assert.equal(sessions("2026-11-02T21:00:00Z").US.status,"closed");
});
test("US Friday remains open after the Korean calendar has crossed into Saturday",()=>{
  const result=sessions("2026-10-16T16:00:00Z");
  assert.equal(result.KR.date,"2026-10-17");assert.equal(result.US.date,"2026-10-16");
  assert.equal(result.preferredMarket,"US");
});
test("US holidays and early closing dates override normal weekday hours",()=>{
  for(const date of ["2026-07-03T15:00:00Z","2026-11-26T15:00:00Z","2027-06-18T15:00:00Z"])
    assert.equal(sessions(date).US.status,"closed");
  assert.equal(sessions("2026-11-27T17:59:00Z").US.status,"regular");
  assert.equal(sessions("2026-11-27T18:00:00Z").US.status,"closed");
  assert.equal(sessions("2026-12-24T18:00:00Z").US.status,"closed");
  assert.equal(sessions("2028-07-03T17:00:00Z").US.status,"closed");
});
test("NYSE does not observe Saturday January 1 2028 on December 31 2027",()=>{
  assert.equal(sessions("2027-12-31T15:00:00Z").US.status,"regular");
});
test("an unsupported US calendar year is unknown, not assumed open",()=>{
  assert.equal(sessions("2029-01-08T15:00:00Z").US.status,"unknown");
  assert.equal(sessions("2029-01-08T15:00:00Z").preferredMarket,null);
});
test("KIS holiday parsing requires the exact date and opening flag",()=>{
  const rows=[{bass_dt:"20261015",opnd_yn:"N"},{bass_dt:"20261016",opnd_yn:"Y",bzdy_yn:"N"}];
  assert.equal(parseKisTradingDay(rows,"2026-10-16"),true);
  assert.equal(parseKisTradingDay(rows,"2026-10-15"),false);
  for(const data of [null,{},[],{bass_dt:"20261016",bzdy_yn:"Y"},{bass_dt:"20261015",opnd_yn:"Y"}])
    assert.equal(parseKisTradingDay(data,"2026-10-16"),null);
});
test("session responses expire promptly and preserve server UTC timestamps",()=>{
  const r=sessions("2026-10-16T00:00:00Z");
  assert.equal(Date.parse(r.expiresAt)-Date.parse(r.checkedAt),90000);
  assert.equal(marketLocalTime(new Date(r.checkedAt),"KR").minutes,540);
});

const sessionUrl=`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const routeSource=ts.transpileModule(await readFile(new URL("../app/api/markets/session/route.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
async function sessionRoute(signedIn,instant,day) {
  const code=routeSource
    .replace(/import .* from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/auth";/,'const currentUserId=async()=>'+JSON.stringify(signedIn ? "qa" : null)+';')
    .replace(/import .* from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/market-calendar";/,`export let calendarCalls=0; export let requestedDate=null; const domesticTradingDay=async(date)=>{calendarCalls++;requestedDate=date;return ${JSON.stringify(day)};};`)
    .replace('"../../../market-sessions"',JSON.stringify(sessionUrl));
  const fixed=`const Date=class extends globalThis.Date { constructor(value){super(value ?? ${JSON.stringify(instant)})} };\n`;
  return import(`data:text/javascript;base64,${Buffer.from(fixed+code).toString("base64")}`);
}
test("market-session endpoint denies unauthenticated calendar access",async()=>{
  const route=await sessionRoute(false,"2026-10-16T01:00:00Z",true);
  assert.equal((await route.GET()).status,401);assert.equal(route.calendarCalls,0);
});
test("market-session endpoint reads only today's Seoul calendar and keeps responses private",async()=>{
  const route=await sessionRoute(true,"2026-10-16T01:00:00Z",true);
  const response=await route.GET(); const body=await response.json();
  assert.equal(body.preferredMarket,"KR");assert.equal(route.requestedDate,"2026-10-16");
  assert.equal(response.headers.get("Cache-Control"),"private, no-store");
});
test("market-session endpoint skips KIS calendar calls outside domestic session hours",async()=>{
  const route=await sessionRoute(true,"2026-10-16T16:00:00Z",true);
  assert.equal((await (await route.GET()).json()).preferredMarket,"US");
  assert.equal(route.calendarCalls,0);
});
