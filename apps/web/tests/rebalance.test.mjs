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
const { rebalance, allocatePortfolioBuys, withinTolerance } = await import(
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
  assert.match(first.items[1].advice, /첫 번째 후보만/);
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


test("unaffordable purchase exposes portfolio limit separately from total new money", () => {
  const p = plan([["a", "A"]], [rule("X", "B", 2000)]);
  const result = rebalance(p, [holding("a", "A", 10)], "add-only", 1000);
  const blocked = result.items.find(item => item.bucket.id === "B").unaffordableBuys[0];
  assert.equal(result.buyBudget, 1000);
  assert.equal(blocked.unitKrw, 2000);
  assert.equal(blocked.limitKrw, 1000);
  assert.equal(blocked.limitedBy, "target");
  assert.equal(result.trades.length, 0);
});

test("target gap can cap a portfolio purchase even with a larger total budget", () => {
  const p = plan([["a", "A"], ["b", "B"]], [rule("X", "B", 2000)]);
  const result = rebalance(p, [holding("a", "A", 15), holding("b", "B", 5)], "add-only", 1500);
  const blocked = result.items.find(item => item.bucket.id === "B").unaffordableBuys[0];
  assert.equal(result.buyBudget, 1500);
  assert.equal(blocked.limitKrw, 1250);
  assert.equal(blocked.limitedBy, "target");
  assert.ok(blocked.limitKrw < result.buyBudget);
  assert.equal(result.trades.length, 0);
});


test("buying increases a portfolio value while its weight can fall after new funds", () => {
  const rows = [holding("a", "A", 182, 100), holding("b", "B", 75, 100), holding("c", "C", 743, 100)];
  const p = plan([["a", "A"], ["b", "B"], ["c", "C"]], [rule("A", "A", 100), rule("Y", "B", 1800)], {
    tolerancePercent: 2,
    buckets: [
      {id:"A", name:"Nasdaq", targetPercent:20, color:"#000"},
      {id:"B", name:"Kospi", targetPercent:10, color:"#000"},
      {id:"C", name:"Other", targetPercent:70, color:"#000"},
    ],
  });
  const result = rebalance(p, rows, "add-only", 2000);
  const item = result.items.find(item => item.bucket.id === "A");
  const buys = result.trades.filter(trade => trade.bucketId === "A" && trade.side === "buy");
  assert.equal(buys.reduce((sum, trade) => sum + trade.amountKrw, 0), 200);
  assert.equal(item.currentPercent, 18.2);
  assert.ok(item.fundedPercent < item.projectedPercent);
  assert.ok(item.projectedPercent < item.currentPercent);
  assert.equal(item.fundedPercent, 18200 / 102000 * 100);
  assert.equal(item.projectedPercent, 18400 / 102000 * 100);
  assertMatchesActual(result, p, rows);
});


test("joint allocation brings all feasible portfolios inside tolerance instead of filling the biggest gap first", () => {
  const rows = [holding("a", "A", 0), holding("b", "B", 10), holding("c", "C", 45), holding("d", "D", 45)];
  const p = plan([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]], [rule("A", "A"), rule("B", "B")], {
    tolerancePercent: 15,
    buckets: ["A", "B", "C", "D"].map(id => ({id, name:id, targetPercent:25, color:"#000"})),
  });
  const result = rebalance(p, rows, "add-only", 2000);
  assert.equal(result.trades.find(trade => trade.bucketId === "A").shares, 15);
  assert.equal(result.trades.find(trade => trade.bucketId === "B").shares, 5);
  for (const item of result.items) assert.ok(Math.abs(item.projectedPercent - item.bucket.targetPercent) <= 15);
  assert.equal(result.residualCash, 0);
  assertMatchesActual(result, p, rows);
});

test("joint allocation is independent of portfolio order and cannot exceed budget or target gaps", () => {
  const entries=[{id:"A",gap:3000,unitKrw:100,empty:false},{id:"B",gap:2000,unitKrw:100,empty:false}];
  const result=allocatePortfolioBuys(entries,2000,0);
  assert.equal(result.get("A"),12);assert.equal(result.get("B"),8);
  assert.deepEqual([...result].sort(),[...allocatePortfolioBuys([...entries].reverse(),2000,0)].sort());
  for(let i=1;i<=50;i++){
    const items=[{id:"A",gap:i*111,unitKrw:17.3,empty:false},{id:"B",gap:i*77,unitKrw:29.9,empty:true},{id:"C",gap:i*143,unitKrw:105,empty:false}];
    const budget=i*123.4;
    const allocations=allocatePortfolioBuys(items,budget,i*10);
    let spent=0;
    for(const item of items){const shares=allocations.get(item.id);assert.ok(Number.isInteger(shares)&&shares>=0);assert.ok(shares*item.unitKrw<=item.gap+1e-7);spent+=shares*item.unitKrw;}
    assert.ok(spent<=budget+1e-7);
  }
});

test("final state discloses remaining overweight portfolios when new money cannot reach the range", () => {
  const rows=[holding("a","A",90),holding("b","B",10)];
  const p=plan([["a","A"],["b","B"]],[rule("B","B")],{tolerancePercent:2});
  const result=rebalance(p,rows,"add-only",1000);
  const overweight=result.items.find(item=>item.bucket.id==="A");
  assert.ok(overweight.projectedPercent>overweight.bucket.targetPercent+2);
  assert.equal(overweight.projectedValue,9000);
  assert.equal(result.trades.some(trade=>trade.side==="sell"),false);
  assertMatchesActual(result,p,rows);
});


test("final tolerance labels use the actual percentage including exact boundaries and empty small targets", () => {
  assert.equal(withinTolerance(20,18,2),true);
  assert.equal(withinTolerance(20,17.9,2),false);
  assert.equal(withinTolerance(1,0,2),true);
  assert.equal(withinTolerance(25,25+1e-12,0),true);
});

test('each portfolio can choose a different purchase candidate and projections match all trades', () => {
  const rows = [holding('a', 'AX', 10)];
  const p = plan([['a', 'A']], [rule('AX','A',100),rule('AY','A',50),rule('BX','B',1500),rule('BY','B',100)]);
  const result = rebalance(p, rows, 'add-only', 3000, new Set(), {buyRuleIds:{A:'AY',B:'BY'}});
  assert.deepEqual(result.trades.filter(t=>t.side==='buy').map(t=>t.symbol).sort(), ['AY','BY']);
  assert.equal(result.residualCash,0);
  assertMatchesActual(result,p,rows);
});
test('explicit purchase never falls back to another stock, including blocked and stale choices', () => {
  const rows=[holding('a','AX',10)];
  const p=plan([['a','A']], [rule('AX','A',100),rule('BX','B',1500),rule('BY','B',100)]);
  for (const options of [
    {buyRuleIds:{B:'BX'},candidatePolicy:'fallback'},
    {buyRuleIds:{B:'AX'},candidatePolicy:'fallback'},
    {buyRuleIds:{B:'BY'},candidatePolicy:'fallback',excludedBuySymbols:new Set(['KR:BY'])},
  ]) {
    const result=rebalance(p,rows,'add-only',1000,new Set(),options);
    assert.equal(result.trades.filter(t=>t.side==='buy').length,0);
    assert.equal(result.residualCash,1000);
    assertMatchesActual(result,p,rows);
  }
});
test('selected sale stock limits liquidation, respects exclusions and updates joint purchase budget', () => {
  const rows=[holding('x','X',10,100),holding('y','Y',10,50),holding('z','Z',1,100)];
  const p=plan([['x','A'],['y','A'],['z','B']], [rule('X','A',100),rule('Y','A',50),rule('Z','B',100)]);
  const result=rebalance(p,rows,'trade',0,new Set(),{sellSymbols:{A:'KR:Y'}});
  assert.deepEqual(result.trades.filter(t=>t.side==='sell').map(t=>t.symbol),['Y']);
  assert.equal(result.trades.find(t=>t.side==='sell').shares,10);
  assertMatchesActual(result,p,rows);
  const excluded=rebalance(p,rows,'trade',0,new Set(['y']),{sellSymbols:{A:'KR:Y'}});
  assert.equal(excluded.trades.length,0);
  assertMatchesActual(excluded,p,rows);
});

test("direct cash portfolio gets a monetary target gap after stock sales",()=>{
 const p=plan([['stock','A']],[],{manualAssets:[{id:'cash',bucketId:'B',name:'네이버 CMA RP',valueKrw:300,valueUsd:null}]});
 const result=rebalance(p,[holding('stock','X',7)],'trade',0,new Set());
 const cash=result.items.find(i=>i.bucket.id==='B');
 assert.deepEqual(cash.amountAdjustment,{direction:'increase',amountKrw:200,currentKrw:300,targetKrw:500});
 close(result.residualCash,200);close(cash.projectedValue,300);
 assert.ok(!result.trades.some(t=>t.bucketId==='B'));
});
test("cash surplus is proposed as money to move without automatically spending it",()=>{
 const p=plan([['stock','A']],[rule('X','A')],{manualAssets:[{id:'cash',bucketId:'B',name:'예비 자금',valueKrw:700,valueUsd:null}]});
 const result=rebalance(p,[holding('stock','X',3)],'trade',0,new Set());
 assert.deepEqual(result.items.find(i=>i.bucket.id==='B').amountAdjustment,{direction:'decrease',amountKrw:200,currentKrw:700,targetKrw:500});
 assert.equal(result.trades.length,0);close(result.residualCash,0);
});
test("cash adjustment uses the total including new money and respects tolerance",()=>{
 const p=plan([['stock','A']],[],{manualAssets:[{id:'cash',bucketId:'B',name:'현금',valueKrw:300,valueUsd:null}]});
 const added=rebalance(p,[holding('stock','X',7)],'add-only',400,new Set());
 assert.deepEqual(added.items.find(i=>i.bucket.id==='B').amountAdjustment,{direction:'increase',amountKrw:400,currentKrw:300,targetKrw:700});
 const tolerant=rebalance({...p,tolerancePercent:2,manualAssets:[{...p.manualAssets[0],valueKrw:490}]},[holding('stock','X',5.1)],'trade',0,new Set());
 assert.equal(tolerant.items.find(i=>i.bucket.id==='B').amountAdjustment.direction,'hold');assert.equal(tolerant.items.find(i=>i.bucket.id==='B').amountAdjustment.amountKrw,0);
});
test("USD cash uses current FX valuation and mixed portfolios are not treated as cash-only",()=>{
 const p=plan([['stock','A']],[],{usdKrw:100,manualAssets:[{id:'cash',bucketId:'B',name:'달러',valueKrw:99999,valueUsd:2}]});
 const result=rebalance(p,[holding('stock','X',8)],'trade',0,new Set());
 assert.deepEqual(result.items.find(i=>i.bucket.id==='B').amountAdjustment,{direction:'increase',amountKrw:300,currentKrw:200,targetKrw:500});
 const mixed=rebalance({...p,assignments:[...p.assignments,{holdingId:'second',bucketId:'B',source:'manual'}]},[holding('stock','X',8),holding('second','Y',1)],'trade',0,new Set());
 assert.equal(mixed.items.find(i=>i.bucket.id==='B').amountAdjustment,null);
});

test("cash stays fixed while sales and new funding jointly finance final stock weights", () => {
  const rows = [holding("a", "X", 6), holding("b", "Y", 2)];
  const p = plan([["a", "A"], ["b", "B"]], [rule("X", "A"), rule("Y", "B")], {
    buckets: [
      { id: "A", name: "A", targetPercent: 40, color: "#000" },
      { id: "B", name: "B", targetPercent: 40, color: "#fff" },
      { id: "C", name: "현금", targetPercent: 20, color: "#999" },
    ],
    manualAssets: [{ id: "cash", bucketId: "C", name: "현금", valueKrw: 200, valueUsd: null }],
  });
  const original = JSON.stringify(p);
  const result = rebalance(p, rows, "trade", 250, new Set(), { preserveCash: true });
  close(result.targetTotal, 1250);
  close(result.buyBudget, 350);
  assert.equal(result.trades.find(t => t.side === "sell").shares, 1);
  assert.equal(result.trades.find(t => t.side === "buy").shares, 3);
  close(result.residualCash, 50);
  const cash = result.items.find(i => i.bucket.id === "C");
  assert.equal(cash.fixedAmount, true);
  assert.equal(cash.amountAdjustment, null);
  close(cash.projectedValue, 200);
  close(cash.projectedPercent, 16);
  assert.equal(JSON.stringify(p), original);
  assertMatchesActual(result, p, rows);
});

test("new funding prevents sales that are no longer overweight after funding", () => {
  const rows = [holding("a", "X", 6), holding("b", "Y", 4)];
  const p = plan([["a", "A"], ["b", "B"]], [rule("Y", "B")]);
  const result = rebalance(p, rows, "trade", 200, new Set(), { preserveCash: true });
  assert.equal(result.trades.some(t => t.side === "sell"), false);
  assert.equal(result.trades.find(t => t.side === "buy").shares, 2);
  close(result.items[0].projectedPercent, 50);
  close(result.items[1].projectedPercent, 50);
  assertMatchesActual(result, p, rows);
});

test("fixed cash is never spent even when it makes stock targets unreachable", () => {
  const rows = [holding("a", "X", 1), holding("b", "Y", 1)];
  const p = plan([["a", "A"], ["b", "B"]], [rule("X", "A"), rule("Y", "B")], {
    buckets: [
      { id: "A", name: "A", targetPercent: 45, color: "#000" },
      { id: "B", name: "B", targetPercent: 45, color: "#fff" },
      { id: "C", name: "현금", targetPercent: 10, color: "#999" },
    ],
    manualAssets: [{ id: "cash", bucketId: "C", name: "현금", valueKrw: 800, valueUsd: null }],
  });
  const result = rebalance(p, rows, "trade", 0, new Set(), { preserveCash: true });
  assert.equal(result.trades.length, 0);
  close(result.buyBudget, 0);
  close(result.items.find(i => i.bucket.id === "C").projectedValue, 800);
  assert.equal(withinTolerance(45, result.items[0].projectedPercent, 0), false);
  assertMatchesActual(result, p, rows);
  for (const input of [null, -500, NaN, Infinity]) {
    const invalid = rebalance(p, rows, "trade", input, new Set(), { preserveCash: true });
    close(invalid.newCash, 0);
    assertMatchesActual(invalid, p, rows);
  }
});
