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
const model = url(await compile("../app/portfolio-model.ts"));
const trade = url(await compile("../app/position-trade.ts"));
const rb = url(
  (await compile("../app/rebalance.ts")).replace(
    '"./portfolio-model"',
    JSON.stringify(model),
  ),
);
const runs = url(
  (await compile("../app/rebalance-runs.ts"))
    .replace('"./portfolio-model"', JSON.stringify(model))
    .replace('"./rebalance"', JSON.stringify(rb))
    .replace('"./position-trade"', JSON.stringify(trade)),
);
const {
  freezeRunSnapshot,
  runItemProgress,
  captureRunOutcome,
  validRunConfig,
  validRunExecution,
  calculateRunPosition,
} = await import(runs);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = {
  mode: "trade",
  newCash: 0,
  cashBucketId: "",
  preferredMarket: null,
  candidatePolicy: "priority",
  excludedHoldingIds: [],
  excludedBuySymbols: [],
  buyRuleIds: {},
  sellSymbols: {},
  cryptoAssetIds: {},
  buyHoldingIds: {},
};
const plan = {
  title: "QA",
  usdKrw: 1400,
  usdKrwMode: "auto",
  tolerancePercent: 2,
  buckets: [
    { id: id(1), name: "A", targetPercent: 50, color: "#000000" },
    { id: id(2), name: "B", targetPercent: 50, color: "#ffffff" },
  ],
  rules: [
    {
      id: id(3),
      bucketId: id(2),
      market: "KR",
      symbol: "005930",
      name: "삼성전자",
      quotedPrice: 100,
      manualPrice: null,
    },
  ],
  assignments: [{ holdingId: id(4), bucketId: id(1), source: "manual" }],
  cryptoAssets: [],
  manualAssets: [],
  snapshots: [],
  cashFlows: [],
};
const holding = {
  id: id(4),
  market: "KR",
  name: "QA",
  symbol: "000001",
  accountId: id(8),
  broker: "QA",
  account: "테스트",
  quantity: 100,
  averageCost: 80,
  currentPrice: 100,
  capturedPrice: null,
  revision: "1",
};
const snapshot = () => {
  let n = 20;
  return freezeRunSnapshot(
    structuredClone(plan),
    [structuredClone(holding)],
    structuredClone(config),
    () => id(n++),
  );
};
const fill = (itemId, quantity) => ({
  id: id(99),
  itemId,
  holdingId: holding.id,
  quantity,
  price: 100,
  fee: 0,
  currency: "KRW",
  fxRate: 1400,
  createdAt: new Date().toISOString(),
  source: "plan",
});
test("a frozen plan retains quantities, targets, prices and new money after live values change", () => {
  const p = structuredClone(plan),
    h = structuredClone(holding);
  let n = 20;
  const frozen = freezeRunSnapshot(p, [h], { ...config, newCash: 1000 }, () =>
    id(n++),
  );
  const original = JSON.stringify(frozen);
  h.quantity = 90;
  h.currentPrice = 200;
  p.usdKrw = 1600;
  p.buckets[0].targetPercent = 40;
  assert.equal(JSON.stringify(frozen), original);
  assert.equal(frozen.newCash, 1000);
  assert.equal(frozen.items.find((i) => i.side === "sell").quantity, 45);
});
test("partial fills reduce only the remaining fixed quantity, not the recommendation target", () => {
  const item = snapshot().items.find((i) => i.side === "sell");
  assert.deepEqual(runItemProgress(item, [fill(item.id, 10)]), {
    executed: 10,
    remaining: 40,
    done: false,
  });
  assert.deepEqual(
    runItemProgress(item, [fill(item.id, 10), fill(item.id, 40)]),
    { executed: 50, remaining: 0, done: true },
  );
  assert.equal(runItemProgress(item, [fill(id(555), 999)]).remaining, 50);
});
test("manual fills exceeding the recommendation do not create negative remaining amounts", () => {
  const item = snapshot().items[0];
  assert.equal(runItemProgress(item, [fill(item.id, 60)]).remaining, 0);
});
test("fractional bitcoin progress has eight-place precision without rounding into a whole coin", () => {
  const item = { ...snapshot().items[0], kind: "crypto", quantity: 0.00000003 };
  assert.deepEqual(runItemProgress(item, [fill(item.id, 0.00000001)]), {
    executed: 0.00000001,
    remaining: 0.00000002,
    done: false,
  });
  assert.equal(
    runItemProgress(item, [
      fill(item.id, 0.00000001),
      fill(item.id, 0.00000002),
    ]).done,
    true,
  );
});
test("new stock buys and fractional crypto buys recalculate average cost; sales preserve remaining basis", () => {
  assert.equal(
    calculateRunPosition(
      { kind: "stock" },
      { quantity: 0, averageCost: null },
      { side: "buy", quantity: 2, price: 100, fee: 2 },
    ).averageCost,
    101,
  );
  const buy = calculateRunPosition(
    { kind: "crypto" },
    { quantity: 0.01, averageCost: 100000000 },
    { side: "buy", quantity: 0.00000001, price: 120000000, fee: 0 },
  );
  assert.equal(buy.quantity, 0.01000001);
  assert.ok(buy.averageCost > 100000000);
  const sell = calculateRunPosition(
    { kind: "crypto" },
    { quantity: 0.01, averageCost: 100000000 },
    { side: "sell", quantity: 0.001, price: 110000000, fee: 0 },
  );
  assert.equal(sell.quantity, 0.009);
  assert.equal(sell.averageCost, 100000000);
  assert.throws(() =>
    calculateRunPosition(
      { kind: "crypto" },
      { quantity: 0.01, averageCost: null },
      { side: "buy", quantity: 0.001, price: 1e8, fee: 0 },
    ),
  );
  assert.throws(() =>
    calculateRunPosition(
      { kind: "crypto" },
      { quantity: 0.01, averageCost: 1 },
      { side: "sell", quantity: 0.02, price: 1, fee: 0 },
    ),
  );
});
test("completion compares actual holdings against the original target and detects changed designs", () => {
  const snap = snapshot();
  const p = structuredClone(plan);
  p.buckets[0].targetPercent = 40;
  const final = captureRunOutcome(snap, p, [{ ...holding, quantity: 50 }]);
  assert.equal(final.configurationChanged, true);
  assert.equal(final.weights[0].targetPercent, 50);
  assert.equal(final.total, 5000);
  assert.equal(final.weights[0].percent, 100);
});
test("invalid creation settings and execution amounts are rejected before database access", () => {
  assert.equal(validRunConfig(config), true);
  for (const c of [
    { ...config, newCash: NaN },
    { ...config, preferredMarket: "JP" },
    { ...config, excludedHoldingIds: ["foreign"] },
    { ...config, cryptoAssetIds: { bad: id(1) } },
    { ...config, buyRuleIds: [] },
  ])
    assert.equal(validRunConfig(c), false);
  const valid = {
    requestId: id(1),
    runId: id(2),
    itemId: id(3),
    revision: 0,
    quantity: 1,
    price: 100,
    fee: 0,
    fxRate: 1400,
    expectedQuantity: 10,
    expectedRevision: "123",
    accountId: null,
    cash: null,
  };
  assert.equal(validRunExecution(valid), true);
  for (const bad of [
    { quantity: 0 },
    { quantity: Infinity },
    { price: -1 },
    { fee: -1 },
    { revision: 0.5 },
    { expectedQuantity: -1 },
    { cash: { assetId: "foreign", expectedBalance: 0 } },
    { expectedRevision: "abc" },
  ])
    assert.equal(validRunExecution({ ...valid, ...bad }), false);
});
let api = await compile("../app/api/rebalance-plans/route.ts");
const state = { user: "owner", calls: [] };
globalThis.__runApiTest = state;
api = api
  .replace(
    /import \{ currentUserId \} from "\.\.\/\.\.\/\.\.\/lib\/auth";/,
    `const currentUserId=async()=>globalThis.__runApiTest.user;`,
  )
  .replace(
    /import \{[^;]+\} from "\.\.\/\.\.\/\.\.\/lib\/rebalance-runs-db";/,
    `const listRebalanceRuns=async(...args)=>{globalThis.__runApiTest.calls.push(['list',...args]);return {active:null,history:[],nextOffset:null};};const startRebalanceRun=async(...args)=>{globalThis.__runApiTest.calls.push(['start',...args]);return {};};const cancelRebalanceRun=async(...args)=>{globalThis.__runApiTest.calls.push(['cancel',...args]);};const executeRebalanceItem=async(...args)=>{globalThis.__runApiTest.calls.push(['execute',...args]);return {};};`,
  )
  .replace('"../../rebalance-runs"', JSON.stringify(runs))
  .replace('"../../position-trade"', JSON.stringify(trade));
const route = await import(url(api));
const request = (body, origin = "http://localhost") =>
  new Request("http://localhost/api/rebalance-plans", {
    method: "POST",
    headers: { origin, host: "localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("run API denies signed-out, cross-origin and malformed writes", async () => {
  state.calls = [];
  state.user = null;
  assert.equal((await route.POST(request({}))).status, 401);
  state.user = "owner";
  assert.equal(
    (await route.POST(request({}, "https://attacker.example"))).status,
    403,
  );
  assert.equal(
    (await route.POST(request({ action: "execute", execution: {} }))).status,
    400,
  );
  assert.equal(
    (
      await route.GET(
        new Request("http://localhost/api/rebalance-plans?offset=-1"),
      )
    ).status,
    400,
  );
  assert.equal(state.calls.length, 0);
});
test("run API derives ownership from the session and ignores a forged owner in the body", async () => {
  state.calls = [];
  state.user = "owner";
  assert.equal(
    (
      await route.POST(
        request({ action: "start", id: id(50), config, userId: "victim" }),
      )
    ).status,
    200,
  );
  assert.equal(state.calls[0][1], "owner");
  const response = await route.GET(
    new Request("http://localhost/api/rebalance-plans?offset=20"),
  );
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(state.calls[1], ["list", "owner", 20]);
});

test("completion detects an account move or crypto allocation change against frozen items", () => {
  const snap = snapshot();
  const p = structuredClone(plan);
  assert.equal(
    captureRunOutcome(snap, p, [{ ...holding, accountId: id(999) }])
      .configurationChanged,
    true,
  );
});
