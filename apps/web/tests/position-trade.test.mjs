import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
const modelUrl = url(await compile("../app/position-trade.ts"));
const { calculatePositionTrade, calculateTradeCash, validateHoldingTrade } =
  await import(modelUrl);
const id = "11111111-1111-4111-8111-111111111111";
const expected = {
  quantity: 10,
  averageCost: 100,
  market: "US",
  symbol: "AAPL",
  accountId: id,
  revision: "123",
};
const input = (more = {}) => ({
  side: "buy",
  quantity: 2,
  price: 150,
  fee: 10,
  expected: { ...expected },
  ...more,
});
test("additional purchase computes a weighted average including fees", () => {
  const p = calculatePositionTrade(expected, input());
  assert.equal(p.quantity, 12);
  assert.equal(p.averageCost, 109.166667);
  assert.equal(p.realisedGain, null);
});
test("partial sale keeps the remaining average and computes only this sale gain", () => {
  const p = calculatePositionTrade(
    expected,
    input({ side: "sell", quantity: 3, price: 130, fee: 3 }),
  );
  assert.equal(p.quantity, 7);
  assert.equal(p.averageCost, 100);
  assert.equal(p.realisedGain, 87);
});
test("full sale returns zero shares and clears the remaining basis", () => {
  const p = calculatePositionTrade(
    expected,
    input({ side: "sell", quantity: 10 }),
  );
  assert.equal(p.quantity, 0);
  assert.equal(p.averageCost, null);
});
test("fractional shares remain stable without introducing rounding into the average", () => {
  const p = calculatePositionTrade(
    { quantity: 0.1, averageCost: 10 },
    { side: "buy", quantity: 0.2, price: 20, fee: 0 },
  );
  assert.equal(p.quantity, 0.3);
  assert.equal(p.averageCost, 16.666667);
  assert.equal(
    calculatePositionTrade(p, {
      side: "sell",
      quantity: 0.1,
      price: 30,
      fee: 0,
    }).quantity,
    0.2,
  );
});
test("unknown existing cost prevents inventing a purchase basis but allows a sale", () => {
  assert.throws(
    () => calculatePositionTrade({ quantity: 10, averageCost: null }, input()),
    /기존 평균/,
  );
  assert.equal(
    calculatePositionTrade(
      { quantity: 10, averageCost: null },
      input({ side: "sell" }),
    ).averageCost,
    null,
  );
});
test("overselling, invalid trades and unsafe numbers are rejected", () => {
  for (const patch of [
    { side: "sell", quantity: 11 },
    { quantity: 0 },
    { quantity: 0.0000001 },
    { quantity: Infinity },
    { price: NaN },
    { price: -1 },
    { fee: -1 },
    { side: "other" },
  ])
    assert.throws(() => calculatePositionTrade(expected, input(patch)));
  for (const value of [
    null,
    {},
    input({ side: "other" }),
    input({ expected: { ...expected, revision: "" } }),
    input({ expected: { ...expected, accountId: "wrong" } }),
  ])
    assert.equal(validateHoldingTrade(value), false);
  assert.equal(validateHoldingTrade(input()), true);
});

const state = {
  user: "owner",
  calls: [],
  missing: false,
  snapshotFails: false,
  row: null,
  backup: null,
};
globalThis.__pfTradeTest = state;
const reset = () => {
  state.user = "owner";
  state.calls = [];
  state.missing = false;
  state.snapshotFails = false;
  state.cash = { name: "달러", value_krw: "1400000", value_usd: "1000" };
  state.cashMissing = false;
  state.row = {
    quantity: "10",
    average_cost: "100",
    market: "US",
    symbol: "AAPL",
    account_id: id,
    revision: "123",
  };
};
let dbCode = await compile("../lib/holding-trades-db.ts");
dbCode = dbCode
  .replace(
    /import \{ db \} from "\.\/db";/,
    `const client={query:async(sql,args)=>{const s=globalThis.__pfTradeTest;s.calls.push({sql,args});if(sql==='begin'){s.backup={...s.row};s.cashBackup={...s.cash};}if(sql==='rollback'){s.row=s.backup;s.cash=s.cashBackup;}if(sql.startsWith('select usd_krw'))return {rows:[{usd_krw:'1400'}]};if(sql.startsWith('select name, value_krw'))return {rows:s.cashMissing?[]:[s.cash]};if(sql.startsWith('update portfolio.manual_assets'))s.cash={...s.cash,value_krw:String(args[2]),value_usd:args[3]===null?null:String(args[3])};if(sql.startsWith('select quantity'))return {rows:s.missing?[]:[s.row]};if(sql.startsWith('update portfolio.holdings'))s.row={...s.row,quantity:String(args[2]),average_cost:args[3]===null?null:String(args[3]),revision:'124'};if(sql.startsWith('delete from'))s.row=null;return {rows:[]};},release(){}};const db=()=>({connect:async()=>client});`,
  )
  .replace(
    /import \{ recordSnapshot, listPortfolio \} from "\.\/portfolio-db";/,
    `const listPortfolio=async(user,client)=>({manualAssets:[globalThis.__pfTradeTest.cash]});const recordSnapshot=async(user,client)=>{if(globalThis.__pfTradeTest.snapshotFails)throw new Error('snapshot failure');};`,
  )
  .replace(
    /import \{ listHoldings \} from "\.\/holdings-db";/,
    `const listHoldings=async(user,client)=>{if(!client)throw new Error('read must share transaction');const row=globalThis.__pfTradeTest.row;return row?[{quantity:Number(row.quantity),averageCost:Number(row.average_cost)}]:[];};`,
  )
  .replace('"../app/position-trade"', JSON.stringify(modelUrl));
const dbUrl = url(dbCode);
const { applyHoldingTrade } = await import(dbUrl);
test("owner lock and current revision protect server-side math and atomic snapshots", async () => {
  reset();
  const result = await applyHoldingTrade("owner", id, input());
  assert.equal(result.position.averageCost, 109.166667);
  assert.equal(result.holdings[0].quantity, 12);
  const lock = state.calls.find((c) => c.sql.includes("for update"));
  assert.deepEqual(lock.args, ["owner", id]);
  assert.match(lock.sql, /user_id = \$1/);
  assert.ok(state.calls.some((c) => c.sql === "commit"));
});
test("duplicate requests and ABA stale revisions cannot be applied twice", async () => {
  reset();
  await applyHoldingTrade("owner", id, input());
  await assert.rejects(
    () => applyHoldingTrade("owner", id, input()),
    (e) => e.status === 409,
  );
  reset();
  state.row.revision = "124";
  await assert.rejects(
    () => applyHoldingTrade("owner", id, input()),
    (e) => e.status === 409,
  );
  assert.equal(
    state.calls.some((c) => c.sql.startsWith("update ")),
    false,
  );
});
test("missing or foreign holding does not mutate any row", async () => {
  reset();
  state.missing = true;
  await assert.rejects(
    () => applyHoldingTrade("other-user", id, input()),
    (e) => e.status === 404,
  );
  assert.equal(
    state.calls.some(
      (c) => c.sql.startsWith("update ") || c.sql.startsWith("delete "),
    ),
    false,
  );
});
test("full sale deletes only the selected owner holding and snapshot failures roll back", async () => {
  reset();
  const result = await applyHoldingTrade(
    "owner",
    id,
    input({ side: "sell", quantity: 10 }),
  );
  assert.deepEqual(result.holdings, []);
  assert.deepEqual(
    state.calls.find((c) => c.sql.startsWith("delete from")).args,
    ["owner", id],
  );
  reset();
  state.snapshotFails = true;
  await assert.rejects(() => applyHoldingTrade("owner", id, input()));
  assert.equal(state.row.quantity, "10");
  assert.equal(state.row.average_cost, "100");
  assert.ok(state.calls.some((c) => c.sql === "rollback"));
  assert.equal(
    state.calls.some((c) => c.sql === "commit"),
    false,
  );
});
let routeCode = (await compile("../app/api/holdings/trades/route.ts"))
  .replace(
    /import \{ NextResponse \} from "next\/server";/,
    "const NextResponse={json:(body,options)=>Response.json(body,options)};",
  )
  .replace(
    /import \{ currentUserId \} from "[^\"]+";/,
    "const currentUserId=async()=>globalThis.__pfTradeTest.user;",
  )
  .replace('"../../../../lib/holding-trades-db"', JSON.stringify(dbUrl))
  .replace('"../../../position-trade"', JSON.stringify(modelUrl));
const { POST } = await import(url(routeCode));
const request = (body, origin = "http://127.0.0.1:3011") =>
  new Request("http://127.0.0.1:3011/api/holdings/trades", {
    method: "POST",
    headers: {
      origin,
      host: "127.0.0.1:3011",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
test("trade endpoint uses authenticated owner and denies cross-origin or invalid payloads", async () => {
  reset();
  state.user = null;
  assert.equal((await POST(request({ id, trade: input() }))).status, 401);
  reset();
  assert.equal(
    (await POST(request({ id, trade: input() }, "https://other.example")))
      .status,
    403,
  );
  for (const body of [
    null,
    {},
    { id: "bad", trade: input() },
    { id, trade: input({ price: -1 }) },
  ])
    assert.equal((await POST(request(body))).status, 400);
  assert.equal(state.calls.length, 0);
  const response = await POST(
    request({ id, trade: input(), userId: "intruder" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.find((c) => c.sql.includes("for update")).args, [
    "owner",
    id,
  ]);
});

const { withPreviousQuotes } = await import(
  url(await compile("../app/holdings.ts"))
);
test("saving a position preserves matching live quotes without discarding its new revision", () => {
  const previous = {
    id: "row",
    market: "US",
    symbol: "AAPL",
    exchange: "NAS",
    quantity: 10,
    averageCost: 180,
    revision: "old",
    currentPrice: 330,
    quoteLabel: "KIS",
    quoteCheckedAt: "now",
  };
  const saved = {
    ...previous,
    quantity: 12,
    averageCost: 185,
    revision: "new",
    currentPrice: null,
    quoteLabel: null,
    quoteCheckedAt: null,
  };
  const [result] = withPreviousQuotes([saved], [previous]);
  assert.equal(result.quantity, 12);
  assert.equal(result.averageCost, 185);
  assert.equal(result.revision, "new");
  assert.equal(result.currentPrice, 330);
  assert.equal(
    withPreviousQuotes([{ ...saved, symbol: "MSFT" }], [previous])[0]
      .currentPrice,
    null,
  );
});

test("cash purchase debits dollars including fees and full sale credits net proceeds", async () => {
  reset();
  const cash = { assetId: id, expectedBalance: 1000 };
  const r = await applyHoldingTrade("owner", id, input({ cash }));
  assert.equal(r.cashChange.balance, 690);
  assert.equal(state.cash.value_usd, "690");
  assert.equal(state.cash.value_krw, "966000");
  assert.equal(r.portfolio.manualAssets[0].value_usd, "690");
  await assert.rejects(
    () => applyHoldingTrade("owner", id, input({ cash })),
    (e) => e.status === 409,
  );
  assert.equal(state.cash.value_usd, "690");
  reset();
  const sold = await applyHoldingTrade(
    "owner",
    id,
    input({ side: "sell", quantity: 10, price: 130, fee: 3, cash }),
  );
  assert.equal(sold.cashChange.balance, 2297);
  assert.deepEqual(sold.holdings, []);
});
test("KRW settlement updates won and failed settlement rolls back both assets", async () => {
  reset();
  state.row.market = "KR";
  state.cash.value_usd = null;
  const r = await applyHoldingTrade(
    "owner",
    id,
    input({
      expected: { ...expected, market: "KR" },
      cash: { assetId: id, expectedBalance: 1400000 },
    }),
  );
  assert.equal(r.cashChange.balance, 1399690);
  assert.equal(state.cash.value_usd, null);
  for (const kind of [
    "currency",
    "missing",
    "stale",
    "insufficient",
    "snapshot",
  ]) {
    reset();
    if (kind === "currency") state.cash.value_usd = null;
    if (kind === "missing") state.cashMissing = true;
    if (kind === "insufficient") state.cash.value_usd = "1";
    if (kind === "snapshot") state.snapshotFails = true;
    await assert.rejects(() =>
      applyHoldingTrade(
        "owner",
        id,
        input({
          cash: {
            assetId: id,
            expectedBalance:
              kind === "stale" ? 999 : kind === "insufficient" ? 1 : 1000,
          },
        }),
      ),
    );
    assert.equal(state.row.quantity, "10");
    assert.equal(
      state.cash.value_usd,
      kind === "currency" ? null : kind === "insufficient" ? "1" : "1000",
    );
    assert.equal(
      state.calls.some((c) => c.sql === "commit"),
      false,
    );
  }
});
test("cash validation rejects forged IDs and balances", () => {
  for (const cash of [
    { assetId: "bad", expectedBalance: 10 },
    { assetId: id, expectedBalance: -1 },
    { assetId: id, expectedBalance: NaN },
  ])
    assert.equal(validateHoldingTrade(input({ cash })), false);
  assert.throws(() => calculateTradeCash(1, input(), "US"), /부족/);
  assert.throws(
    () => calculateTradeCash(0, input({ side: "sell", fee: 1000 }), "US"),
    /부족/,
  );
  assert.equal(
    calculateTradeCash(
      10,
      { side: "buy", quantity: 0.1, price: 0.3, fee: 0 },
      "US",
    ).balance,
    9.97,
  );
});
