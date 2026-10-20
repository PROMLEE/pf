import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const code = ts.transpileModule(
  await readFile(new URL("../app/average-price.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { calculateAveragePrice: calculate, purchaseWithinBudget } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const input = {
  quantity: 10,
  averagePrice: 100000,
  buyPrice: 80000,
  mode: "quantity",
  amount: 5,
  fractional: false,
};
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test("averaging down preserves the full old cost basis", () => {
  const r = calculate(input);
  assert.equal(r.totalQuantity, 15);
  assert.equal(r.totalCost, 1400000);
  assert.equal(r.additionalCost, 400000);
  close(r.averagePrice, 1400000 / 15);
  assert.ok(r.changePercent < 0);
  close(r.beforeGainPercent, -20);
  close(r.afterGainPercent, (80000 / (1400000 / 15) - 1) * 100);
});
test("averaging up and equal-price purchases are handled", () => {
  const r = calculate({ ...input, buyPrice: 120000 });
  close(r.averagePrice, 1600000 / 15);
  assert.ok(r.changePercent > 0);
  close(r.beforeGainPercent, 20);
  close(r.afterGainPercent, 12.5);
  assert.equal(calculate({ ...input, buyPrice: 100000 }).changePercent, 0);
});
test("a whole-share budget respects the limit and returns unused cash", () => {
  const r = calculate({ ...input, mode: "budget", amount: 250000 });
  assert.equal(r.additionalQuantity, 3);
  assert.equal(r.additionalCost, 240000);
  assert.equal(r.remainingBudget, 10000);
  const none = calculate({ ...input, mode: "budget", amount: 1000 });
  assert.equal(none.additionalQuantity, 0);
  assert.equal(none.averagePrice, input.averagePrice);
});
test("target average solves minimum whole shares in either direction", () => {
  const down = calculate({ ...input, mode: "target", amount: 95000 });
  assert.equal(down.additionalQuantity, 4);
  assert.ok(down.averagePrice <= 95000);
  assert.ok(
    (input.quantity * input.averagePrice + 3 * input.buyPrice) / 13 > 95000,
  );
  const up = calculate({
    ...input,
    buyPrice: 120000,
    mode: "target",
    amount: 105000,
  });
  assert.equal(up.additionalQuantity, 4);
  assert.ok(up.averagePrice >= 105000);
});
test("unreachable target averages are rejected instead of showing negative or infinite purchases", () => {
  for (const target of [80000, 100000, 110000, 75000])
    assert.throws(
      () => calculate({ ...input, mode: "target", amount: target }),
      /목표 평단가/,
    );
  assert.throws(() =>
    calculate({ ...input, buyPrice: 100000, mode: "target", amount: 100000 }),
  );
});
test("crypto fractional budgets are rounded down to eight decimals", () => {
  const r = calculate({
    quantity: 0.02,
    averagePrice: 90000000,
    buyPrice: 80000000,
    mode: "budget",
    amount: 10000,
    fractional: true,
  });
  assert.equal(r.additionalQuantity, 0.000125);
  assert.equal(r.additionalCost, 10000);
  assert.ok(r.averagePrice < 90000000);
  const edge = calculate({
    quantity: 1,
    averagePrice: 1,
    buyPrice: 0.1,
    mode: "budget",
    amount: 0.3,
    fractional: false,
  });
  assert.equal(edge.additionalQuantity, 3);
  assert.equal(edge.additionalCost, 0.3);
  assert.equal(edge.remainingBudget, 0);
});
test("target fractional quantity is rounded upward to reach the target", () => {
  const r = calculate({
    quantity: 0.02,
    averagePrice: 90000000,
    buyPrice: 80000000,
    mode: "target",
    amount: 87000000,
    fractional: true,
  });
  assert.ok(r.averagePrice <= 87000000);
  const q = r.additionalQuantity - 1e-8;
  assert.ok((0.02 * 90000000 + q * 80000000) / (0.02 + q) > 87000000);
});
test("invalid precision, zero, unsafe numbers and invalid modes are rejected", () => {
  assert.throws(() => calculate({ ...input, amount: 1.5 }));
  assert.throws(() =>
    calculate({ ...input, amount: 0.123456789, fractional: true }),
  );
  for (const n of [NaN, Infinity, -1, 0])
    assert.throws(() => calculate({ ...input, buyPrice: n }));
  assert.throws(() => calculate({ ...input, quantity: 1e16 }));
  assert.throws(() => calculate({ ...input, mode: "invalid" }));
});

test("cash capacity works without a known existing quantity or cost basis", () => {
  assert.deepEqual(purchaseWithinBudget(1000000, 80000, false), {
    quantity: 12,
    cost: 960000,
    remaining: 40000,
  });
  assert.deepEqual(purchaseWithinBudget(1000, 300, false), {
    quantity: 3,
    cost: 900,
    remaining: 100,
  });
  assert.deepEqual(purchaseWithinBudget(0, 300, false), {
    quantity: 0,
    cost: 0,
    remaining: 0,
  });
  assert.deepEqual(purchaseWithinBudget(1000, 2000, false), {
    quantity: 0,
    cost: 0,
    remaining: 1000,
  });
});
test("cash fractions and fractional coin lots never exceed the selected balance", () => {
  assert.equal(purchaseWithinBudget(1000000 * 0.25, 80000, false).quantity, 3);
  assert.equal(purchaseWithinBudget(1000000 * 0.5, 80000, false).quantity, 6);
  const r = purchaseWithinBudget(10000, 80000000, true);
  assert.equal(r.quantity, 0.000125);
  assert.equal(r.cost, 10000);
  for (const [budget, price, fractional] of [
    [0.3, 0.1, false],
    [1000, 300, true],
    [1, 3, true],
    [50000, 132029, false],
  ]) {
    const value = purchaseWithinBudget(budget, price, fractional);
    assert.ok(value.cost <= budget);
    assert.ok(value.remaining >= 0);
    assert.ok(value.quantity >= 0);
  }
});
test("invalid or unsafe cash capacity inputs fail before filling a quantity", () => {
  for (const balance of [-1, NaN, Infinity, 1e16])
    assert.throws(() => purchaseWithinBudget(balance, 300, false));
  for (const price of [0, -1, NaN, Infinity])
    assert.throws(() => purchaseWithinBudget(1000, price, false));
  assert.throws(() => purchaseWithinBudget(1000000, 1e-20, true));
});
