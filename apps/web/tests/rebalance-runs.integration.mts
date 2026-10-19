// Explicit opt-in, existing disposable local GUEST QA user only. ALL mutations
// are wrapped in an outer transaction and rolled back, including snapshots.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { listPortfolio } from "../lib/portfolio-db";
import { listHoldings } from "../lib/holdings-db";
import {
  startRebalanceRun,
  listRebalanceRuns,
  executeRebalanceItem,
  cancelRebalanceRun,
  replaceRebalanceItem,
} from "../lib/rebalance-runs-db";
import { applyHoldingTrade } from "../lib/holding-trades-db";
import {
  runItemProgress,
  previewRunReplacement,
  type RunConfig,
  type RunExecution,
  type RunItem,
} from "../app/rebalance-runs";
if (process.env.PF_REBALANCE_DB_TEST !== "1")
  throw Error(
    "Set PF_REBALANCE_DB_TEST=1 to run the rollback-only local QA test.",
  );
process.loadEnvFile(".env.local");
const userId = process.env.LOCAL_ADMIN_USER_ID;
if (!userId) throw Error("Missing local QA user");
const pool = db();
const client = await pool.connect();
const qa = await client.query(
  `select "oauthProvider" from public."User" where "userId"=$1`,
  [userId],
);
assert.equal(
  qa.rows[0]?.oauthProvider,
  "GUEST",
  "This test must never use a real social-login account",
);
const before = await client.query(
  `select count(*)::int as count from portfolio.rebalance_runs where user_id=$1`,
  [userId],
);
await client.query("begin");
const proxy = {
  query: async (sql: any, args?: any[]) => {
    if (sql === "begin") return client.query("savepoint rebalance_test");
    if (sql === "commit")
      return client.query("release savepoint rebalance_test");
    if (sql === "rollback") {
      await client.query("rollback to savepoint rebalance_test");
      return client.query("release savepoint rebalance_test");
    }
    return client.query(sql, args);
  },
  release() {},
};
(globalThis as any).portfolioPool = {
  query: proxy.query,
  connect: async () => proxy,
};
try {
  // Temporarily park any existing disposable QA plan inside the outer
  // transaction. Other connections keep seeing the original until rollback.
  await client.query(
    `update portfolio.rebalance_runs set status='cancelled',ended_at=now() where user_id=$1 and status='active'`,
    [userId],
  );
  const config: RunConfig = {
    mode: "trade",
    newCash: 0,
    cashBucketId: "",
    preferredMarket: null,
    candidatePolicy: "fallback",
    excludedHoldingIds: [],
    excludedBuySymbols: [],
    buyRuleIds: {},
    sellSymbols: {},
    cryptoAssetIds: {},
    buyHoldingIds: {},
  };
  const id = randomUUID();
  let run = await startRebalanceRun(userId, id, config);
  const original = JSON.stringify(run.snapshot);
  assert.equal((await startRebalanceRun(userId, id, config)).id, id);
  await assert.rejects(
    () => startRebalanceRun(userId, randomUUID(), config),
    /진행 중/,
  );
  const account = (
    await client.query(
      `select id from portfolio.accounts where user_id=$1 limit 1`,
      [userId],
    )
  ).rows[0].id;
  async function input(item: RunItem, quantity: number): Promise<RunExecution> {
    const holdings = await listHoldings(userId),
      p = (await listPortfolio(userId))!;
    const h = item.holdingId
      ? holdings.find((h) => h.id === item.holdingId)
      : holdings.find(
          (h) =>
            h.accountId === account &&
            h.market === item.market &&
            h.symbol === item.symbol,
        );
    return {
      requestId: randomUUID(),
      runId: run.id,
      itemId: item.id,
      revision: run.revision,
      quantity,
      price: item.unitPrice,
      fee: 0,
      fxRate: p.usdKrw,
      expectedQuantity:
        h?.quantity ??
        p.cryptoAssets.find((c) => c.id === item.assetId)?.quantity ??
        0,
      expectedRevision: h?.revision,
      accountId: item.accountId ?? account,
      cash: null,
    };
  }
  const sell = run.snapshot.items.find(
    (i) => i.kind === "stock" && i.side === "sell" && i.quantity >= 2,
  )!;
  assert.ok(sell, "QA seed needs an overweight stock");
  const alternate = (
    await client.query(
      `select id from portfolio.accounts where user_id=$1 and id<>$2 limit 1`,
      [userId, sell.accountId],
    )
  ).rows[0]?.id;
  if (alternate) {
    await client.query(
      `update portfolio.holdings set account_id=$3 where user_id=$1 and id=$2`,
      [userId, sell.holdingId, alternate],
    );
    const inputMoved = await input(sell, 1);
    await assert.rejects(
      () => executeRebalanceItem(userId, inputMoved),
      /계좌나 종목/,
    );
    await client.query(
      `update portfolio.holdings set account_id=$3 where user_id=$1 and id=$2`,
      [userId, sell.holdingId, sell.accountId],
    );
  }
  const coin = run.snapshot.items.find((i) => i.kind === "crypto");
  if (coin) {
    const p = (await listPortfolio(userId))!;
    const different = p.buckets.find((b) => b.id !== coin.bucketId)!.id;
    await client.query(
      `update portfolio.crypto_assets set bucket_id=$3 where user_id=$1 and id=$2`,
      [userId, coin.assetId, different],
    );
    const wrongBucket = await input(coin, 0.00000001);
    await assert.rejects(
      () => executeRebalanceItem(userId, wrongBucket),
      /포트 배정/,
    );
    await client.query(
      `update portfolio.crypto_assets set bucket_id=$3 where user_id=$1 and id=$2`,
      [userId, coin.assetId, coin.bucketId],
    );
  }
  const first = await input(sell, 1);
  await client.query(
    `update portfolio.holdings set quote_checked_at=now(), quote_label='QA quote refresh' where user_id=$1 and id=$2`,
    [userId, sell.holdingId],
  );
  assert.equal(
    (await listHoldings(userId)).find((h) => h.id === sell.holdingId)!.revision,
    first.expectedRevision,
  );
  await executeRebalanceItem(userId, first);
  run = (await listRebalanceRuns(userId)).active!;
  assert.equal(runItemProgress(sell, run.fills).remaining, sell.quantity - 1);
  assert.equal(JSON.stringify(run.snapshot), original);
  assert.equal(
    (await executeRebalanceItem(userId, first)).alreadyRecorded,
    true,
  );
  assert.equal((await listRebalanceRuns(userId)).active!.fills.length, 1);
  await assert.rejects(
    () => executeRebalanceItem(userId, { ...first, quantity: 2 }),
    /이미 사용/,
  );
  const stale = { ...(await input(sell, 1)), revision: 0 };
  await assert.rejects(
    () => executeRebalanceItem(userId, stale),
    /변경|종료|반영/,
  );
  const current = (await listHoldings(userId)).find(
    (h) => h.id === sell.holdingId,
  )!;
  const trade = {
    side: "sell" as const,
    quantity: 1,
    price: sell.unitPrice,
    fee: 0,
    fxRate: 1400,
    cash: null,
    expected: {
      quantity: current.quantity,
      averageCost: current.averageCost,
      market: current.market,
      symbol: current.symbol,
      accountId: current.accountId!,
      revision: current.revision!,
    },
  };
  for (let n = 0; n < 3; n++)
    await client.query(
      `update portfolio.holdings set current_price=current_price+1,quote_checked_at=now(),updated_at=now() where user_id=$1 and id=$2`,
      [userId, current.id],
    );
  assert.equal(
    (await listHoldings(userId)).find((h) => h.id === current.id)!.revision,
    current.revision,
  );
  const normal = await applyHoldingTrade(userId, current.id, trade);
  await assert.rejects(
    () => applyHoldingTrade(userId, current.id, trade),
    /보유 정보가 변경/,
  );
  const afterTrade = (await listHoldings(userId)).find(
    (h) => h.id === current.id,
  )!;
  const abaTrade = {
    ...trade,
    expected: {
      ...trade.expected,
      quantity: afterTrade.quantity,
      averageCost: afterTrade.averageCost,
      revision: afterTrade.revision!,
    },
  };
  await client.query(
    `update portfolio.holdings set quantity=quantity+1 where user_id=$1 and id=$2`,
    [userId, current.id],
  );
  await client.query(
    `update portfolio.holdings set quantity=quantity-1 where user_id=$1 and id=$2`,
    [userId, current.id],
  );
  assert.notEqual(
    (await listHoldings(userId)).find((h) => h.id === current.id)!.revision,
    afterTrade.revision,
  );
  await assert.rejects(
    () => applyHoldingTrade(userId, current.id, abaTrade),
    /보유 정보가 변경/,
  );
  assert.equal(normal.progressRecorded, true);
  run = (await listRebalanceRuns(userId)).active!;
  assert.equal(runItemProgress(sell, run.fills).remaining, sell.quantity - 2);
  assert.equal(JSON.stringify(run.snapshot), original);
  const buy = run.snapshot.items.find(
    (i) => i.kind === "stock" && i.side === "buy" && i.currency === "KRW",
  )!;
  assert.ok(buy);
  const p = (await listPortfolio(userId))!,
    cash = p.manualAssets.find((c) => c.valueUsd === null)!;
  assert.ok(cash);
  const bad = {
    ...(await input(buy, 1)),
    price: 1e9,
    cash: { assetId: cash.id, expectedBalance: cash.valueKrw },
  };
  const beforeBad = JSON.stringify(await listHoldings(userId));
  await assert.rejects(() => executeRebalanceItem(userId, bad), /잔고가 부족/);
  assert.equal(JSON.stringify(await listHoldings(userId)), beforeBad);
  const foreign = {
    ...(await input(buy, 1)),
    cash: { assetId: randomUUID(), expectedBalance: 0 },
  };
  await assert.rejects(
    () => executeRebalanceItem(userId, foreign),
    /현금 자산/,
  );
  assert.equal(JSON.stringify(await listHoldings(userId)), beforeBad);
  const paid = {
    ...(await input(buy, 1)),
    price: 100,
    cash: { assetId: cash.id, expectedBalance: cash.valueKrw },
  };
  await executeRebalanceItem(userId, paid);
  run = (await listRebalanceRuns(userId)).active!;
  assert.equal(
    (await listPortfolio(userId))!.manualAssets.find((c) => c.id === cash.id)!
      .valueKrw,
    cash.valueKrw - 100,
  );
  await executeRebalanceItem(userId, paid);
  assert.equal(
    (await listPortfolio(userId))!.manualAssets.find((c) => c.id === cash.id)!
      .valueKrw,
    cash.valueKrw - 100,
  );
  assert.equal((await listRebalanceRuns("not-the-owner")).history.length, 0);
  const otherExecution = await input(sell, 1);
  await assert.rejects(
    () => executeRebalanceItem("not-the-owner", otherExecution),
    /먼저 만들어/,
  );
  for (const item of run.snapshot.items) {
    const remaining = runItemProgress(item, run.fills).remaining;
    if (remaining > 0) {
      await executeRebalanceItem(userId, await input(item, remaining));
      const listing = await listRebalanceRuns(userId);
      run = listing.active ?? listing.history.find((r) => r.id === id)!;
    }
  }
  assert.equal(run.status, "completed");
  assert.ok(run.outcome);
  assert.equal(JSON.stringify(run.snapshot), original);
  assert.ok(
    run.snapshot.items.every((i) => runItemProgress(i, run.fills).done),
  );
  let next = await startRebalanceRun(userId, randomUUID(), {
    ...config,
    mode: "add-only",
    newCash: 3000000,
  });
  const switchItem = next.snapshot.items.find(
    (i) => i.side === "buy" && i.quantity >= 2,
  )!;
  assert.ok(switchItem, "QA needs a replaceable buy");
  await executeRebalanceItem(userId, {
    ...(await input(switchItem, 1)),
    runId: next.id,
    revision: next.revision,
  });
  next = (await listRebalanceRuns(userId)).active!;
  const altRuleId = randomUUID();
  await client.query(
    `insert into portfolio.rules(id,user_id,bucket_id,market,symbol,name,manual_price,position) values($1,$2,$3,'KR','099999','QA replacement',100,999)`,
    [altRuleId, userId, switchItem.bucketId],
  );
  const currentPlan = (await listPortfolio(userId))!;
  const currentHoldings = await listHoldings(userId);
  const preview = previewRunReplacement(
    next,
    switchItem.id,
    `rule:${altRuleId}`,
    currentPlan,
    currentHoldings,
  );
  const edit = {
    changeId: randomUUID(),
    runId: next.id,
    revision: next.revision,
    itemId: switchItem.id,
    selection: `rule:${altRuleId}`,
    expectedQuantity: preview.to.quantity,
    expectedPrice: preview.to.unitPrice,
  };
  const beforeReplace = JSON.stringify(currentHoldings);
  const unaffected = next.snapshot.items.filter(
    (i) => i.bucketId !== switchItem.bucketId,
  );
  const oldRevision = next.revision;
  next = await replaceRebalanceItem(userId, edit);
  assert.equal(JSON.stringify(await listHoldings(userId)), beforeReplace);
  assert.equal(next.revision, oldRevision + 1);
  assert.equal(next.snapshot.changes!.length, 1);
  assert.equal(next.snapshot.changes![0].to.budgetKrw, preview.budget);
  assert.deepEqual(
    next.snapshot.items.filter((i) => i.bucketId !== switchItem.bucketId),
    unaffected,
  );
  assert.equal(
    runItemProgress(
      next.snapshot.items.find((i) => i.id === switchItem.id)!,
      next.fills,
    ).done,
    true,
  );
  const retried = await replaceRebalanceItem(userId, edit);
  assert.equal(retried.revision, next.revision);
  assert.equal(retried.snapshot.changes!.length, 1);
  await assert.rejects(
    () =>
      replaceRebalanceItem(userId, {
        ...edit,
        selection: `rule:${randomUUID()}`,
      }),
    /이미 사용/,
  );
  await assert.rejects(
    () => replaceRebalanceItem(userId, { ...edit, changeId: randomUUID() }),
    /계획이 변경/,
  );
  await assert.rejects(
    () => replaceRebalanceItem("not-the-owner", edit),
    /먼저 만들어/,
  );
  const replacement = next.snapshot.changes![0].to;
  const replacedInput = {
    ...(await input(replacement, 1)),
    runId: next.id,
    revision: next.revision,
  };
  await executeRebalanceItem(userId, replacedInput);
  next = (await listRebalanceRuns(userId)).active!;
  assert.equal(runItemProgress(replacement, next.fills).executed, 1);
  const beforeCancel = JSON.stringify(await listHoldings(userId));
  await cancelRebalanceRun(userId, next.id, next.revision);
  assert.equal(JSON.stringify(await listHoldings(userId)), beforeCancel);
  assert.ok(
    (await listRebalanceRuns(userId)).history.some(
      (r) => r.id === next.id && r.status === "cancelled",
    ),
  );
  console.log(
    "DB integration passed: frozen plan, partial/normal fills, duplicate protection, owner isolation, cash rollback, new holding, fractional crypto, completion, partial replacement, unchanged holdings, revision/owner checks, replacement execution, quote-only refresh without false conflicts, duplicate/ABA protection and cancellation.",
  );
} finally {
  await client.query("rollback");
  (globalThis as any).portfolioPool = pool;
  const after = await client.query(
    `select count(*)::int as count from portfolio.rebalance_runs where user_id=$1`,
    [userId],
  );
  assert.equal(after.rows[0].count, before.rows[0].count);
  client.release();
  await pool.end();
  console.log("QA changes rolled back; original data retained.");
}
