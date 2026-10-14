import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (s) =>
  `data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const helperUrl = url(await compile("../app/fx-gains.ts"));
const { stockGains, cashGains, dailyUsdGains, nextStockBasis, nextCashFx } =
  await import(helperUrl);
const holding = {
  market: "US",
  quantity: 10,
  averageCost: 100,
  averageCostKrw: 130000,
  currentPrice: 110,
  capturedPrice: null,
};
test("stock price and FX decomposition exactly adds to KRW evaluation profit", () => {
  const included = stockGains(holding, 1400, true),
    excluded = stockGains(holding, 1400, false);
  assert.equal(included.gain, 240000);
  assert.equal(included.priceGain, 140000);
  assert.equal(included.fxGain, 100000);
  assert.equal(included.priceGain + included.fxGain, included.gain);
  assert.equal(excluded.gain, 140000);
  assert.equal(included.value, excluded.value);
});
test("unknown basis is not invented and Korean ETFs never double count FX", () => {
  assert.equal(
    stockGains({ ...holding, averageCostKrw: null }, 1400, true).gain,
    null,
  );
  assert.equal(stockGains({ ...holding, market: "KR" }, 1400, true).gain, 100);
  assert.equal(
    stockGains({ ...holding, currentPrice: null }, 1400, true).gain,
    null,
  );
  assert.equal(
    cashGains({ valueUsd: 1000, averageFxRate: null }, 1400).gain,
    null,
  );
  assert.equal(
    cashGains({ valueUsd: 1000, averageFxRate: 1300 }, 1400).gain,
    100000,
  );
});
test("daily FX compares previous reference without requiring historic purchase cost", () => {
  assert.deepEqual(dailyUsdGains(110, 100, 10, 1400, 1300, true), {
    gain: 240000,
    base: 1300000,
  });
  assert.deepEqual(dailyUsdGains(110, 100, 10, 1400, null, false), {
    gain: 140000,
    base: 1400000,
  });
  assert.equal(dailyUsdGains(110, 100, 10, 1400, null, true), null);
});
test("weighted bases preserve unknown history, keep sale basis, and clear empty balances", () => {
  assert.equal(nextStockBasis(10, 130000, "buy", 2, 150, 10, 1400), 144500);
  assert.equal(nextStockBasis(10, null, "buy", 2, 150, 10, 1400), null);
  assert.equal(nextStockBasis(10, 130000, "sell", 2, 150, 0, 1400), 130000);
  assert.equal(nextStockBasis(10, 130000, "sell", 10, 150, 0, 1400), null);
  assert.equal(nextCashFx(1000, 1300, -500, 1400), 1300);
  assert.equal(nextCashFx(1000, null, 300, 1400), null);
  assert.equal(nextCashFx(0, null, 300, 1400), 1400);
  assert.equal(nextCashFx(1000, 1300, -1000, 1400), null);
});
let state = { user: "owner", allowed: true, calls: [] };
globalThis.__pfBasis = state;
let code = (await compile("../app/api/holdings/basis/route.ts"))
  .replace(
    /import \{ NextResponse \} from "next\/server";/,
    "const NextResponse={json:(body,options)=>Response.json(body,options)};",
  )
  .replace(
    /import \{ currentUserId \} from "[^\"]+";/,
    "const currentUserId=async()=>globalThis.__pfBasis.user;",
  )
  .replace(
    /import \{ db \} from "[^\"]+";/,
    `const client={query:async(sql,args)=>{const s=globalThis.__pfBasis;s.calls.push({sql,args});return {rowCount:s.allowed?1:0};},release(){}};const db=()=>({connect:async()=>client});`,
  )
  .replace(
    /import \{ listHoldings \} from "[^\"]+";/,
    "const listHoldings=async()=>[];",
  )
  .replace('"../../../fx-gains"', JSON.stringify(helperUrl));
const { PATCH } = await import(url(code));
const id = "11111111-1111-4111-8111-111111111111";
const request = (body, origin = "http://localhost:3011") =>
  new Request("http://localhost:3011/api/holdings/basis", {
    method: "PATCH",
    headers: {
      origin,
      host: "localhost:3011",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("basis endpoint authenticates, validates, rejects CSRF and protects owner/revision", async () => {
  state.user = null;
  assert.equal(
    (await PATCH(request({ id, revision: "123", averageCostKrw: 130000 })))
      .status,
    401,
  );
  state.user = "owner";
  assert.equal(
    (
      await PATCH(
        request(
          { id, revision: "123", averageCostKrw: 130000 },
          "https://other.example",
        ),
      )
    ).status,
    403,
  );
  for (const body of [
    null,
    {},
    { id, revision: "123", averageCostKrw: -1 },
    { id, revision: 123, averageCostKrw: 130000 },
  ])
    assert.equal((await PATCH(request(body))).status, 400);
  state.allowed = false;
  assert.equal(
    (await PATCH(request({ id, revision: "123", averageCostKrw: 130000 })))
      .status,
    409,
  );
  state.allowed = true;
  const r = await PATCH(
    request({
      id,
      revision: "123",
      averageCostKrw: 130000,
      userId: "intruder",
    }),
  );
  assert.equal(r.status, 200);
  const update = state.calls.find((c) => c.sql.startsWith("update"));
  assert.match(update.sql, /user_id=\$1/);
  assert.match(update.sql, /xmin::text=\$4/);
  assert.match(update.sql, /market='US'/);
  assert.deepEqual(update.args, ["owner", id, 130000, "123"]);
});

const { fetchPreviousUsdKrw } = await import(
  url(await compile("../lib/fx.ts"))
);
test("previous reference chooses the last valid earlier observation through weekends", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json([
        null,
        { date: "2026-10-09", base: "USD", quote: "KRW", rate: 1340 },
        { date: "2026-10-12", base: "USD", quote: "KRW", rate: 1330 },
        { date: "2026-10-13", base: "USD", quote: "KRW", rate: 1345 },
        { date: "2026-10-12", base: "EUR", quote: "KRW", rate: 1500 },
      ]);
    assert.equal(await fetchPreviousUsdKrw("2026-10-13"), 1330);
    globalThis.fetch = async () => Response.json([]);
    assert.equal(await fetchPreviousUsdKrw("2026-10-13"), null);
    globalThis.fetch = async () => new Response("", { status: 502 });
    await assert.rejects(() => fetchPreviousUsdKrw("2026-10-13"));
  } finally {
    globalThis.fetch = original;
  }
});
