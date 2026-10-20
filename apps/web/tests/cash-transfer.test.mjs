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
const modelUrl = url(await compile("../app/cash-transfer.ts"));
const { transferBalances, transferredFx, validCashTransfer } = await import(
  modelUrl
);
const source = "11111111-1111-4111-8111-111111111111",
  dest = "22222222-2222-4222-8222-222222222222",
  id = "33333333-3333-4333-8333-333333333333";
const input = {
  id,
  sourceId: source,
  destinationId: dest,
  amount: 100,
  note: "이체",
  expectedRevision: 0,
};
test("KRW and USD transfers preserve exact balances including large and fractional residuals", () => {
  assert.deepEqual(transferBalances("1000.00", "300.00", 700, "KRW"), {
    source: "300.000000",
    destination: "1000.000000",
  });
  assert.deepEqual(transferBalances("1.000001", "0.123456", 0.25, "USD"), {
    source: "0.750001",
    destination: "0.373456",
  });
  assert.deepEqual(
    transferBalances("1000000000000.000001", "0.000000", 0.01, "USD"),
    { source: "999999999999.990001", destination: "0.010000" },
  );
});
test("invalid, zero, overspent and precision-invalid transfers are blocked", () => {
  for (const amount of [0, -1, NaN, Infinity, 0.0000000001, 1.001])
    assert.throws(() => transferBalances("100.00", "0.00", amount, "USD"));
  assert.throws(() => transferBalances("100.00", "0.00", 0.1, "KRW"));
  assert.throws(() => transferBalances("100.00", "0.00", 101, "KRW"), /부족/);
  assert.throws(() => transferBalances("1", "1000000000000", 1, "USD"), /범위/);
});
test("USD cost basis moves at historical source cost and unknown cost stays unknown", () => {
  assert.equal(transferredFx(1200, 1400, 100, 100), 1300);
  assert.equal(transferredFx(1200, null, 0, 100), 1200);
  assert.equal(transferredFx(null, 1400, 100, 100), null);
  assert.equal(transferredFx(1200, null, 100, 100), null);
  assert.equal(
    100 * 1200 + 200 * transferredFx(1200, 1400, 100, 100),
    200 * 1200 + 100 * 1400,
  );
});
test("request validation rejects same asset, forged IDs, invalid revisions and long notes", () => {
  assert.equal(validCashTransfer(input), true);
  for (const patch of [
    { sourceId: dest },
    { id: "bad" },
    { expectedRevision: -1 },
    { expectedRevision: 0.1 },
    { amount: Infinity },
    { note: "x".repeat(201) },
  ])
    assert.equal(validCashTransfer({ ...input, ...patch }), false);
});
const state = { user: "owner", calls: [], error: null };
globalThis.__cashRoute = state;
let route = await compile("../app/api/portfolio/transfers/route.ts");
route = route
  .replace(
    /import .*? from "next\/server";/,
    "const NextResponse={json:(data,options)=>Response.json(data,options)};",
  )
  .replace(
    /import .*? from ".*?\/lib\/auth";/,
    "const currentUserId=async()=>globalThis.__cashRoute.user;",
  )
  .replace(
    /import .*? from ".*?\/lib\/admin";/,
    'const sameOrigin=r=>r.headers.get("origin")==="http://localhost:3000";',
  )
  .replace(
    /import .*? from ".*?\/lib\/cash-transfers-db";/,
    "const listCashTransfers=async user=>{globalThis.__cashRoute.calls.push(user);return[];};const applyCashTransfer=async(user,input)=>{const s=globalThis.__cashRoute;s.calls.push({user,input});if(s.error)throw s.error;return{portfolio:{}};};",
  )
  .replace('"../../../cash-transfer"', JSON.stringify(modelUrl));
const api = await import(url(route));
const req = (body, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/portfolio/transfers", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("API requires login, validates origin and uses session owner", async () => {
  state.user = null;
  state.calls = [];
  assert.equal((await api.GET()).status, 401);
  assert.equal((await api.POST(req(input))).status, 401);
  state.user = "owner";
  assert.equal(
    (await api.POST(req(input, "https://evil.example"))).status,
    403,
  );
  assert.equal(state.calls.length, 0);
  assert.equal(
    (await api.POST(req({ ...input, userId: "intruder" }))).status,
    200,
  );
  assert.equal(state.calls[0].user, "owner");
  assert.equal(
    (await api.POST(req({ ...input, destinationId: source }))).status,
    400,
  );
});
test("external deposit and withdrawal require exactly one owned endpoint", () => {
  const deposit = { ...input, kind: "deposit", sourceId: null };
  const withdrawal = { ...input, kind: "withdrawal", destinationId: null };
  assert.equal(validCashTransfer(deposit), true);
  assert.equal(validCashTransfer(withdrawal), true);
  for (const patch of [
    { sourceId: source },
    { destinationId: null },
    { fxRate: NaN },
    { fxRate: 99 },
    { fxRate: 1200.1234567 },
    { kind: "bad" },
  ])
    assert.equal(validCashTransfer({ ...deposit, ...patch }), false);
  assert.equal(validCashTransfer({ ...deposit, fxRate: 1335.123456 }), true);
  assert.equal(validCashTransfer({ ...withdrawal, fxRate: 1400 }), false);
});
test("external cash preview changes only the registered side with exact cents", () => {
  assert.equal(
    transferBalances("100.25", "10.123456", 100.25, "USD").destination,
    "110.373456",
  );
  assert.equal(
    transferBalances("110.373456", "0", 10.25, "USD").source,
    "100.123456",
  );
  assert.throws(() => transferBalances("10", "0", 11, "USD"), /부족/);
});
test("external movement API keeps session ownership, origin checks and conflict statuses", async () => {
  state.user = "owner";
  state.calls = [];
  state.error = null;
  const deposit = { ...input, kind: "deposit", sourceId: null, fxRate: 1400 };
  assert.equal(
    (await api.POST(req({ ...deposit, userId: "intruder" }))).status,
    200,
  );
  assert.equal(state.calls[0].user, "owner");
  assert.equal(state.calls[0].input.sourceId, null);
  assert.equal(
    (await api.POST(req({ ...deposit, sourceId: source }))).status,
    400,
  );
  const { CashTransferError } = await import(modelUrl);
  state.error = new CashTransferError("잔액 충돌", 409);
  assert.equal((await api.POST(req(deposit))).status, 409);
  state.error = null;
});
