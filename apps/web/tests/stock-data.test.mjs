import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const state = { kis: true, toss: true, calls: [], failToss: false };
globalThis.__pfStockData = state;
const compile = ts.transpileModule(
  await readFile(new URL("../lib/stock-data.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const fixture = `const s=globalThis.__pfStockData;const make=(row,vendor)=>({...row,price:vendor==='kis'&&row.symbol==='MSFT'?null:100,previousClose:90,currency:row.market==='KR'?'KRW':'USD',checkedAt:'2026-10-01T00:00:00Z',label:vendor});const kisConfigured=()=>s.kis,tossConfigured=()=>s.toss;const quoteKis=async(market,symbol,exchange)=>{s.calls.push({provider:'kis',symbol});return make({market,symbol,exchange:exchange??'NAS'},'kis');};const quoteTossBatch=async rows=>{s.calls.push({provider:'toss',rows});if(s.failToss)throw Error('toss down');return rows.map(row=>make(row,'toss'));};const findInstruments=async()=>[{symbol:'005930'}],findTossInstruments=async()=>[];`;
let code = compile
  .replace(/import \{[^}]+\} from "\.\/kis";/, fixture)
  .replace(/import \{[^}]+\} from "\.\/toss";/, "");
const api = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const env = {
  provider: process.env.STOCK_DATA_PROVIDER,
  fallback: process.env.STOCK_DATA_FALLBACK,
};
const rows = [
  { market: "KR", symbol: "005930", exchange: "KOSPI" },
  { market: "US", symbol: "MSFT", exchange: null },
];
const reset = () => {
  state.kis = true;
  state.toss = true;
  state.calls = [];
  state.failToss = false;
  delete process.env.STOCK_DATA_PROVIDER;
  delete process.env.STOCK_DATA_FALLBACK;
};
test("KIS stays primary; only failures use Toss; original exchange identity is retained", async () => {
  reset();
  const result = await api.quoteStocks(rows);
  assert.equal(result[0].label, "kis");
  assert.equal(result[1].label, "toss");
  assert.equal(result[1].exchange, null);
  assert.equal(state.calls.find((c) => c.provider === "toss").rows.length, 1);
});
test("Toss primary supports batch lookup and an explicitly disabled fallback", async () => {
  reset();
  process.env.STOCK_DATA_PROVIDER = "toss";
  const result = await api.quoteStocks(rows);
  assert.ok(result.every((x) => x.label === "toss"));
  assert.equal(state.calls.length, 1);
  reset();
  process.env.STOCK_DATA_FALLBACK = "false";
  const failed = await api.quoteStocks(rows);
  assert.equal(failed[1].price, null);
  assert.ok(state.calls.every((x) => x.provider === "kis"));
});
test("Toss failures fall back with a bounded KIS request count", async () => {
  reset();
  process.env.STOCK_DATA_PROVIDER = "toss";
  state.failToss = true;
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...rows[0],
    symbol: String(i).padStart(6, "0"),
  }));
  const result = await api.quoteStocks(many);
  assert.equal(result.length, 40);
  assert.equal(state.calls.filter((c) => c.provider === "kis").length, 30);
  assert.equal(result.filter((x) => x.price !== null).length, 30);
});
test("missing credentials preserve KIS master search and return explicit missing quotes", async () => {
  reset();
  state.kis = false;
  state.toss = false;
  assert.equal((await api.searchStocks("KR", "삼성"))[0].symbol, "005930");
  assert.equal((await api.quoteStocks(rows))[0].price, null);
});
test("configuration and limits reject invalid values; empty primary search uses fallback", async () => {
  reset();
  process.env.STOCK_DATA_PROVIDER = "invalid";
  assert.throws(() => api.stockDataStatus());
  reset();
  process.env.STOCK_DATA_PROVIDER = "toss";
  assert.equal((await api.searchStocks("KR", "삼성"))[0].symbol, "005930");
  await assert.rejects(
    api.quoteStocks(Array.from({ length: 201 }, () => rows[0])),
    /200/,
  );
});
test.after(() => {
  if (env.provider === undefined) delete process.env.STOCK_DATA_PROVIDER;
  else process.env.STOCK_DATA_PROVIDER = env.provider;
  if (env.fallback === undefined) delete process.env.STOCK_DATA_FALLBACK;
  else process.env.STOCK_DATA_FALLBACK = env.fallback;
});
