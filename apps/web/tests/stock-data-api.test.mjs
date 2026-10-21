import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const state = {
  user: "owner",
  configured: true,
  storeError: false,
  crypto: [],
  rows: [],
  saved: [],
  status: { primary: "toss", available: ["kis", "toss"], fallback: true },
};
globalThis.__pfStockApi = state;
const compile = async (file) =>
  ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const auth = (code) =>
  code.replace(
    /import \{ currentUserId \} from "[^"]+";/,
    "const currentUserId=async()=>globalThis.__pfStockApi.user;",
  );
let code = auth(await compile("../app/api/quotes/route.ts"))
  .replace(
    /import \{ NextResponse \} from "next\/server";/,
    "const NextResponse={json:(body,options)=>Response.json(body,options)};",
  )
  .replace(
    /import \{[^}]+\} from "[^"]+stock-data";/,
    `const stockQuotesConfigured=()=>globalThis.__pfStockApi.configured;const stockDataStatus=()=>({maxSymbols:200});const quoteStocks=async rows=>rows.map((row,i)=>({...row,price:i===0?100:null,previousClose:90,checkedAt:'2026-10-01T00:00:00Z',label:'토스증권 현재가'}));`,
  )
  .replace(
    /import \{[^}]+\} from "[^"]+holdings-db";/,
    `const listHoldings=async()=>globalThis.__pfStockApi.rows;const setQuote=async(user,...args)=>{if(globalThis.__pfStockApi.storeError)throw Error("test write failure");globalThis.__pfStockApi.saved.push({user,args});};`,
  )
  .replace(
    /import \{[^}]+\} from "[^"]+portfolio-db";/,
    "const listCryptoAssets=async()=>globalThis.__pfStockApi.crypto,listRules=async()=>[],recordSnapshot=async()=>{},setRuleQuote=async()=>{};",
  )
  .replace(
    /import \{ refreshStoredCryptoQuotes \} from "[^"]+";/,
    'const refreshStoredCryptoQuotes=async()=>[{marketCode:"KRW-BTC",price:100}];',
  );
const quotes = await import(url(code));
code = auth(await compile("../app/api/market-data/status/route.ts")).replace(
  /import \{ stockDataStatus \} from "[^"]+";/,
  "const stockDataStatus=()=>globalThis.__pfStockApi.status;",
);
const status = await import(url(code));
const request = (origin) =>
  new Request("http://localhost:3000/api/quotes", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: origin ?? "http://localhost:3000",
    },
  });
const reset = () => {
  state.user = "owner";
  state.configured = true;
  state.storeError = false;
  state.crypto = [];
  state.rows = [
    { market: "KR", symbol: "005930", exchange: "KOSPI" },
    { market: "US", symbol: "MSFT", exchange: null },
  ];
  state.saved = [];
};
test("quote and status endpoints require a session; mutations reject other origins", async () => {
  reset();
  state.user = null;
  assert.equal((await quotes.POST(request())).status, 401);
  assert.equal((await status.GET()).status, 401);
  reset();
  assert.equal(
    (await quotes.POST(request("https://foreign.example"))).status,
    403,
  );
  assert.equal(state.saved.length, 0);
});
test("quotes persist only valid prices under session owner and retain provider labels", async () => {
  reset();
  const result = await quotes.POST(request());
  assert.equal(result.status, 200);
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].user, "owner");
  assert.equal(state.saved[0].args[4], "토스증권 현재가");
  assert.equal((await result.json()).quotes.length, 2);
});
test("crypto-only refresh remains available without stock provider configuration", async () => {
  reset();
  state.rows = [];
  state.configured = false;
  assert.equal((await quotes.POST(request())).status, 503);
  state.crypto = ["KRW-BTC"];
  assert.equal((await quotes.POST(request())).status, 200);
});
test("status exposes only configuration choices, with private no-store caching", async () => {
  reset();
  state.status = {
    ...state.status,
    clientSecret: "must-not-be-returned",
    order: ["toss", "kis"],
  };
  const result = await status.GET();
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await result.json(), {
    primary: "toss",
    available: ["kis", "toss"],
    fallback: true,
  });
});

test("a failed quote write does not cancel crypto results or expose invalid daily data", async () => {
  reset();
  state.storeError = true;
  state.crypto = ["KRW-BTC"];
  const response = await quotes.POST(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.quotes[0].price, null);
  assert.equal(body.quotes[0].previousClose, null);
  assert.ok(body.quotes.some((quote) => quote.marketCode === "KRW-BTC"));
});
