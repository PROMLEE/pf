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
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const modelUrl = dataUrl(await compile("../app/portfolio-model.ts"));
const { portfolioValues } = await import(modelUrl);
const { rebalance } = await import(
  dataUrl(
    (await compile("../app/rebalance.ts")).replace(
      '"./portfolio-model"',
      JSON.stringify(modelUrl),
    ),
  )
);
const rule = (symbol, bucketId, price = 100) => ({
  id: symbol,
  symbol,
  name: symbol,
  bucketId,
  market: "KR",
  exchange: "KOSPI",
  quotedPrice: price,
  manualPrice: null,
  quoteCheckedAt: "2026-10-09T00:00:00Z",
});
const holding = (id, symbol, quantity, price = 100) => ({
  id,
  symbol,
  name: symbol,
  market: "KR",
  exchange: "KOSPI",
  broker: "QA",
  account: id,
  quantity,
  currentPrice: price,
  capturedPrice: null,
  capturedAt: "2026-10-09T00:00:00Z",
  averageCost: 100,
  quoteLabel: "KIS",
  quoteCheckedAt: "2026-10-09T00:00:00Z",
});
const plan = (rows, rules, other = {}) => ({
  title: "QA",
  usdKrw: 1400,
  usdKrwMode: "auto",
  usdKrwUpdatedAt: null,
  usdKrwRateDate: "2026-10-09",
  tolerancePercent: 0,
  buckets: [
    { id: "A", name: "A", targetPercent: 50, color: "#000" },
    { id: "B", name: "B", targetPercent: 50, color: "#fff" },
  ],
  assignments: rows.map(([holdingId, bucketId]) => ({
    holdingId,
    bucketId,
    source: "manual",
  })),
  rules,
  cryptoAssets: [],
  manualAssets: [],
  snapshots: [],
  cashFlows: [],
  ...other,
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function assertMatchesActual(result, p, original) {
  const rows = original.map((row) => ({ ...row }));
  const updatedPlan = { ...p, assignments: [...p.assignments], manualAssets: [...p.manualAssets] };
  for (const trade of result.trades) {
    if (trade.holdingId)
      rows.find((row) => row.id === trade.holdingId).quantity +=
        trade.side === "buy" ? trade.shares : -trade.shares;
    else {
      const id = `new:${trade.ruleId}`;
      rows.push({
        ...holding(id, trade.symbol, trade.shares, trade.unitPrice),
        market: trade.market,
      });
      updatedPlan.assignments.push({
        holdingId: id,
        bucketId: trade.bucketId,
        source: "manual",
      });
    }
  }
  if (result.residualCash > 0) updatedPlan.manualAssets.push({ id: "actual-cash", bucketId: null, name: "거래 후 잔여 현금", valueKrw: result.residualCash, valueUsd: null });
  const actual = portfolioValues(updatedPlan, rows);
  for (const item of result.items)
    close(
      item.projectedPercent,
      ((actual.values.get(item.bucket.id) ?? 0) / actual.total) * 100,
    );
  close(actual.total, result.targetTotal);
  close(actual.unassigned, result.residualCash);
  close(result.buyBudget, result.newCash + result.trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + trade.amountKrw, 0));
}

test("direct assignment conflict blocks a buy into a different portfolio", () => {
  const rows = [holding("x", "X", 1, 1000)];
  const p = plan([["x", "A"]], [rule("X", "B", 1000)]);
  const result = rebalance(p, rows, "add-only", 1000, new Set());
  assert.equal(result.trades.length, 0);
  assert.match(result.items[1].advice, /직접 배정/);
  assertMatchesActual(result, p, rows);
});

test("matching direct assignment wins over the first same-code holding", () => {
  const rows = [holding("wrong", "X", 8), holding("right", "X", 2)];
  const p = plan(
    [
      ["wrong", "A"],
      ["right", "B"],
    ],
    [rule("X", "B")],
  );
  const result = rebalance(p, rows, "add-only", 600, new Set());
  assert.equal(result.trades[0].holdingId, "right");
  assert.equal(result.trades[0].shares, 6);
  assertMatchesActual(result, p, rows);
});

test("priority reports an unaffordable candidate; explicit fallback buys next", () => {
  const rows = [holding("a", "A", 10)];
  const p = plan([["a", "A"]], [rule("X", "B", 2000), rule("Y", "B")]);
  const first = rebalance(p, rows, "add-only", 1000, new Set());
  assert.equal(first.trades.length, 0);
  assert.match(first.items[1].advice, /다음 후보는 검토하지/);
  const fallback = rebalance(p, rows, "add-only", 1000, new Set(), {
    candidatePolicy: "fallback",
  });
  assert.equal(fallback.trades[0].symbol, "Y");
  assert.equal(fallback.trades[0].shares, 10);
  assertMatchesActual(fallback, p, rows);
});

test("excluding a sale in one account does not exclude all same-code buys", () => {
  const rows = [
    holding("a", "A", 6),
    holding("b1", "B", 2),
    holding("b2", "B", 2),
  ];
  const p = plan(
    [
      ["a", "A"],
      ["b1", "B"],
      ["b2", "B"],
    ],
    [rule("B", "B")],
  );
  const result = rebalance(p, rows, "add-only", 200, new Set(["b1"]), {
    buyHoldingIds: { B: "b2" },
  });
  assert.equal(result.trades[0].holdingId, "b2");
  assert.equal(result.trades[0].shares, 2);
  const blocked = rebalance(p, rows, "add-only", 200, new Set(), {
    excludedBuySymbols: new Set(["KR:B"]),
  });
  assert.equal(blocked.trades.length, 0);
  assertMatchesActual(result, p, rows);
});

test("existing holding valuation price takes precedence to preserve projections", () => {
  const rows = [holding("a", "A", 8), holding("b", "B", 2)];
  const p = plan(
    [
      ["a", "A"],
      ["b", "B"],
    ],
    [rule("B", "B", 120)],
  );
  const result = rebalance(p, rows, "add-only", 600, new Set());
  assert.equal(result.trades[0].unitPrice, 100);
  assertMatchesActual(result, p, rows);
});

test("zero input means zero budget; null explicitly selects theoretical budget", () => {
  const rows = [holding("a", "A", 10)];
  const p = plan([["a", "A"]], [rule("B", "B")]);
  const empty = rebalance(p, rows, "add-only", 0, new Set());
  assert.equal(empty.newCash, 0);
  assert.equal(empty.trades.length, 0);
  const theoretical = rebalance(p, rows, "add-only", null, new Set());
  assert.equal(theoretical.newCash, 1000);
  assert.equal(theoretical.trades[0].shares, 10);
  assertMatchesActual(theoretical, p, rows);
});

test("funded gaps differ from current gaps and residual cash remains unassigned", () => {
  const rows = [holding("a", "A", 5), holding("b", "B", 5)];
  const p = plan(
    [
      ["a", "A"],
      ["b", "B"],
    ],
    [rule("A", "A"), rule("B", "B")],
  );
  const result = rebalance(p, rows, "add-only", 110, new Set());
  assert.equal(result.items[0].gapPercent, 0);
  assert.ok(result.items[0].fundedGapPercent > 0);
  assert.equal(result.residualCash, 110);
  assertMatchesActual(result, p, rows);
});

test("excluded shares produce no sell trades and explain why", () => {
  const rows = [holding("a", "A", 8), holding("b", "B", 2)];
  const p = plan(
    [
      ["a", "A"],
      ["b", "B"],
    ],
    [rule("B", "B")],
  );
  const result = rebalance(p, rows, "trade", 0, new Set(["a"]));
  assert.equal(result.trades.length, 0);
  assert.match(result.items[0].advice, /매도 제외/);
  assertMatchesActual(result, p, rows);
});

test("stock sales, foreign prices and mixed assets conserve value", () => {
  const rows = [
    { ...holding("a", "A", 8, 1), market: "US" },
    holding("b", "B", 2, 1000),
  ];
  const p = plan(
    [
      ["a", "A"],
      ["b", "B"],
    ],
    [rule("B", "B", 1000)],
    {
      manualAssets: [
        {
          id: "cash",
          name: "현금",
          bucketId: "A",
          valueKrw: 500,
          valueUsd: null,
        },
      ],
      cryptoAssets: [
        {
          id: "btc",
          name: "비트코인",
          bucketId: "B",
          marketCode: "KRW-BTC",
          quantity: 0.01,
          quotedPriceKrw: 10000,
          averageCostKrw: null,
          quoteCheckedAt: null,
          lastTradeAt: null,
        },
      ],
    },
  );
  const result = rebalance(p, rows, "trade", 0, new Set());
  assert.equal(result.trades[0].currency, "USD");
  assert.equal(result.trades[0].usdKrw, 1400);
  assert.match(result.items[0].separateReview, /현금/);
  assert.match(result.items[1].separateReview, /비트코인/);
  assertMatchesActual(result, p, rows);
});

test("selected account must still match the portfolio after rule changes", () => {
  const rows = [holding("a", "A", 8), holding("b", "B", 2)];
  const p = plan(
    [
      ["a", "A"],
      ["b", "B"],
    ],
    [rule("B", "B")],
  );
  const result = rebalance(p, rows, "add-only", 600, new Set(), {
    buyHoldingIds: { B: "a" },
  });
  assert.equal(result.trades.length, 0);
  assert.match(result.items[1].advice, /계좌를 다시 선택/);
});

test('Korean buy recommendations use the held security name even if the rule is unnamed',()=>{
  const rows=[holding('a','A',8),{...holding('b','005930',2),name:'삼성전자'}];
  const p=plan([['a','A'],['b','B']],[{...rule('005930','B'),name:''}]);
  const result=rebalance(p,rows,'add-only',600,new Set());
  assert.equal(result.trades[0].name,'삼성전자');
  assert.match(result.items[1].advice,/삼성전자 .*주 매수/);
});
test('Korean sell recommendations show the name rather than only the code',()=>{
  const rows=[{...holding('a','005930',8),name:'삼성전자'},holding('b','B',2)];
  const p=plan([['a','A'],['b','B']],[rule('B','B')]);
  const result=rebalance(p,rows,'trade',0,new Set());
  assert.match(result.items[0].advice,/삼성전자 .*주 매도/);
});
