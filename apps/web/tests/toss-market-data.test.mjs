import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const compile = async (file) =>
  ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const valuesUrl = url(await compile("../lib/toss-values.ts"));
const {
  tossInstruments,
  tossPriceQuotes,
  previousSessionCutoff,
  tossPreviousClose,
} = await import(valuesUrl);
const rows = [
  { market: "KR", symbol: "0158S0", exchange: "KOSDAQ" },
  { market: "US", symbol: "MSFT", exchange: null },
];
test("Toss catalogs preserve alphanumeric KOSDAQ codes and map supported exchanges", () => {
  assert.deepEqual(
    tossInstruments([{ symbol: "0158S0", name: "엘리스" }], "KOSDAQ"),
    [{ ...rows[0], name: "엘리스" }],
  );
  assert.equal(
    tossInstruments([{ symbol: "MSFT", name: "마이크로소프트" }], "NASDAQ")[0]
      .exchange,
    "NAS",
  );
  assert.equal(
    tossInstruments([{ symbol: "MSFT", name: "마이크로소프트" }], "NASDAQ")[0]
      .market,
    "US",
  );
  assert.throws(() => tossInstruments({}, "KOSDAQ"));
});
test("prices require matching currency and a positive finite value", () => {
  const result = tossPriceQuotes(rows, [
    { symbol: "0158S0", currency: "KRW", lastPrice: "10000" },
    { symbol: "MSFT", currency: "KRW", lastPrice: "100" },
  ]);
  assert.equal(result[0].price, 10000);
  assert.equal(result[0].previousClose, null);
  assert.equal(result[1].price, null);
  for (const value of ["", null, true, "Infinity", "-1", "0"])
    assert.equal(
      tossPriceQuotes(
        [rows[0]],
        [{ symbol: "0158S0", currency: "KRW", lastPrice: value }],
      )[0].price,
      null,
    );
});
test("session cutoffs follow the quote trading day, KST and US daylight saving time", () => {
  assert.equal(
    previousSessionCutoff("2026-10-09T15:30:00+09:00", "KR"),
    "2026-10-08T15:00:00.000Z",
  );
  assert.equal(
    previousSessionCutoff("2026-10-09T16:00:00-04:00", "US"),
    "2026-10-09T04:00:00.000Z",
  );
  assert.equal(
    previousSessionCutoff("2026-01-09T16:00:00-05:00", "US"),
    "2026-01-09T05:00:00.000Z",
  );
  assert.equal(previousSessionCutoff(null, "US"), null);
  assert.equal(previousSessionCutoff("bad", "US"), null);
});
test("daily baseline excludes the current session and wrong-currency or invalid candles", () => {
  const cutoff = "2026-10-09T04:00:00Z";
  assert.equal(
    tossPreviousClose(
      [
        { timestamp: cutoff, closePrice: "999", currency: "USD" },
        {
          timestamp: "2026-10-08T04:00:00Z",
          closePrice: "100",
          currency: "USD",
        },
        {
          timestamp: "2026-10-08T05:00:00Z",
          closePrice: "200",
          currency: "KRW",
        },
      ],
      cutoff,
      "USD",
    ),
    100,
  );
  assert.equal(tossPreviousClose([], cutoff, "USD"), null);
});
let counter = 0;
const state = { calls: [], mode: "success", rotations: 0 };
globalThis.__pfTossTest = state;
const originalFetch = globalThis.fetch;
const searchUrl = url(await compile("../lib/instrument-search.ts"));
let code = await compile("../lib/toss.ts");
code = code
  .replace(
    /import \{ unstable_cache \} from "next\/cache";/,
    `const unstable_cache=fn=>{const map=new Map();return(...args)=>{const key=JSON.stringify(args);if(!map.has(key))map.set(key,fn(...args));return map.get(key);};};`,
  )
  .replace(
    /import \{ tossBase, tossToken \} from "\.\/toss-auth";/,
    `const tossBase=()=>"https://toss-test.invalid";const tossToken=async rejected=>{if(rejected)globalThis.__pfTossTest.rotations++;return rejected?"new-token":"old-token";};`,
  )
  .replace(
    /export \{ tossConfigured \} from "\.\/toss-auth";/,
    "export const tossConfigured=()=>true;",
  )
  .replace('"./toss-values"', JSON.stringify(valuesUrl))
  .replace('"./instrument-search"', JSON.stringify(searchUrl));
const load = () => import(url(code + `\n// instance ${counter++}`));
function mockFetch() {
  state.calls = [];
  state.rotations = 0;
  globalThis.fetch = async (input, options) => {
    const u = new URL(input);
    state.calls.push({
      path: u.pathname,
      params: Object.fromEntries(u.searchParams),
      auth: options.headers.Authorization,
    });
    if (state.mode === "limited" && state.calls.length === 1)
      return Response.json(
        {},
        { status: 429, headers: { "retry-after": "0" } },
      );
    if (state.mode === "blocked")
      return Response.json(
        { error: { message: "secret-should-not-leak" } },
        { status: 403 },
      );
    if (
      state.mode === "expired" &&
      options.headers.Authorization === "Bearer old-token"
    )
      return Response.json({}, { status: 401 });
    if (u.pathname.endsWith("prices"))
      return Response.json({
        result: rows.map((row) => ({
          symbol: row.symbol,
          currency: row.market === "KR" ? "KRW" : "USD",
          lastPrice: "100",
          timestamp:
            row.market === "KR"
              ? "2026-10-09T15:30:00+09:00"
              : "2026-10-09T16:00:00-04:00",
        })),
      });
    if (u.pathname.endsWith("candles"))
      return Response.json({
        result: {
          candles: [
            {
              timestamp: "2026-10-07T00:00:00Z",
              currency: u.searchParams.get("symbol") === "MSFT" ? "USD" : "KRW",
              closePrice: "90",
            },
          ],
        },
      });
    return Response.json({
      result: [
        {
          symbol:
            u.searchParams.get("market") === "KOSDAQ" ? "0158S0" : "005930",
          name:
            u.searchParams.get("market") === "KOSDAQ" ? "엘리스" : "삼성전자",
        },
      ],
    });
  };
}
test("batch current prices are fetched once, with cached previous-session baselines", async () => {
  state.mode = "success";
  mockFetch();
  try {
    const api = await load();
    const result = await api.quoteTossBatch(rows);
    assert.equal(
      state.calls.filter((c) => c.path.endsWith("prices")).length,
      1,
    );
    assert.ok(result.every((q) => q.previousClose === 90));
    await api.quoteTossBatch(rows);
    assert.equal(
      state.calls.filter((c) => c.path.endsWith("candles")).length,
      2,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("unauthorized responses refresh once while IP failures never expose upstream messages", async () => {
  mockFetch();
  try {
    let api = await load();
    state.mode = "expired";
    await api.tossGet("/api/v1/prices", { symbols: "MSFT" });
    assert.equal(state.rotations, 1);
    state.mode = "blocked";
    api = await load();
    const before = state.calls.length;
    await assert.rejects(
      api.tossGet("/api/v1/prices", { symbols: "MSFT" }),
      /허용 IP/,
    );
    assert.equal(state.calls.length - before, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rate limits retry once and do not rotate a valid token", async () => {
  state.mode = "limited";
  mockFetch();
  try {
    const api = await load();
    await api.tossGet("/api/v1/prices", { symbols: "MSFT" });
    assert.equal(state.calls.length, 2);
    assert.equal(state.rotations, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
