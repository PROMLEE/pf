// GUEST-only integration: all writes, including nested transactions, roll back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { addHoldingWithCash, addHoldings } from "../lib/holdings-db";
import type { Holding } from "../app/holdings";
if (process.env.PF_NEW_HOLDING_DB_TEST !== "1")
  throw Error("Set PF_NEW_HOLDING_DB_TEST=1 for rollback-only QA");
process.loadEnvFile(".env.local");
const user = process.env.LOCAL_ADMIN_USER_ID!;
if (!user) throw Error("Missing QA user");
const pool = db(),
  client = await pool.connect();
assert.equal(
  (
    await client.query(
      'select "oauthProvider" from public."User" where "userId"=$1',
      [user],
    )
  ).rows[0]?.oauthProvider,
  "GUEST",
);
await client.query("begin");
let failSnapshot = false;
const proxy = {
  query: async (sql: any, args?: any[]) => {
    if (sql === "begin") return client.query("savepoint new_purchase_qa");
    if (sql === "commit")
      return client.query("release savepoint new_purchase_qa");
    if (sql === "rollback") {
      await client.query("rollback to savepoint new_purchase_qa");
      return client.query("release savepoint new_purchase_qa");
    }
    if (
      failSnapshot &&
      String(sql).includes("insert into portfolio.snapshots")
    ) {
      failSnapshot = false;
      throw Error("QA snapshot failure");
    }
    return client.query(sql, args);
  },
  release() {},
};
(globalThis as any).portfolioPool = {
  query: proxy.query,
  connect: async () => proxy,
};
const account = randomUUID(),
  krw = randomUUID(),
  usd = randomUUID();
const balance = async (id: string) => {
  const r = (
    await client.query(
      "select value_krw,value_usd,average_fx_rate from portfolio.manual_assets where user_id=$1 and id=$2",
      [user, id],
    )
  ).rows[0];
  return {
    balance: Number(r.value_usd ?? r.value_krw),
    basis: r.average_fx_rate == null ? null : Number(r.average_fx_rate),
  };
};
const revision = async () =>
  Number(
    (
      await client.query(
        "select cash_revision from portfolio.plans where user_id=$1",
        [user],
      )
    ).rows[0].cash_revision,
  );
const flows = async () =>
  Number(
    (
      await client.query(
        "select count(*) from portfolio.cash_flows where user_id=$1",
        [user],
      )
    ).rows[0].count,
  );
const stock = (symbol: string, market: "KR" | "US" = "KR"): Holding => ({
  id: randomUUID(),
  accountId: account,
  broker: "QA 증권",
  account: "QA 현금 매수",
  market,
  name: `QA ${symbol}`,
  symbol,
  exchange: market === "KR" ? "KOSDAQ" : "NAS",
  quantity: 2,
  averageCost: market === "KR" ? 100 : 10,
  capturedPrice: null,
  capturedAt: new Date().toISOString(),
  currentPrice: null,
  quoteLabel: null,
  quoteCheckedAt: null,
});
try {
  await client.query(
    "update portfolio.plans set usd_krw=1400 where user_id=$1",
    [user],
  );
  await client.query(
    "insert into portfolio.accounts(id,user_id,broker,name) values($1,$2,'QA 증권',$3)",
    [account, user, `QA ${account}`],
  );
  await client.query(
    "insert into portfolio.manual_assets(id,user_id,name,value_krw,value_usd,average_fx_rate,account_id) values($1,$3,'QA 원화',1000,null,null,$4),($2,$3,'QA 달러',140000,100,1200,$4)",
    [krw, usd, user, account],
  );
  const initialRevision = await revision(),
    initialFlows = await flows();
  const kr = stock("0158S0"),
    us = stock("AAPL", "US");
  const result = await addHoldingWithCash(user, kr, {
    assetId: krw,
    expectedBalance: 1000,
  });
  assert.equal((await balance(krw)).balance, 800);
  assert.equal(result.cashChange?.balance, 800);
  assert.equal(
    result.portfolio?.manualAssets.find((x) => x.id === krw)?.valueKrw,
    800,
  );
  assert.equal(
    result.holdings.filter((x) => x.accountId === account).length,
    1,
  );
  assert.equal(
    result.holdings.find((x) => x.accountId === account)?.capturedPrice,
    100,
  );
  await assert.rejects(
    addHoldingWithCash(user, kr, { assetId: krw, expectedBalance: 1000 }),
    /이미 보유/,
  );
  assert.equal((await balance(krw)).balance, 800);
  const usdResult = await addHoldingWithCash(user, us, {
    assetId: usd,
    expectedBalance: 100,
  });
  assert.deepEqual(await balance(usd), { balance: 80, basis: 1200 });
  assert.equal(
    usdResult.holdings.find(
      (x) => x.accountId === account && x.symbol === "AAPL",
    )?.averageCostKrw,
    14000,
  );
  await assert.rejects(
    addHoldingWithCash(user, stock("005930"), {
      assetId: krw,
      expectedBalance: 1000,
    }),
    (e) => (e as any).status === 409,
  );
  await assert.rejects(
    addHoldingWithCash(
      user,
      { ...stock("MSFT", "US"), quantity: 100 },
      { assetId: usd, expectedBalance: 80 },
    ),
    /잔고가 부족/,
  );
  await assert.rejects(
    addHoldingWithCash(user, stock("005930"), {
      assetId: usd,
      expectedBalance: 80,
    }),
    /국내 주식은 원화/,
  );
  await assert.rejects(
    addHoldingWithCash(user, stock("005930"), {
      assetId: randomUUID(),
      expectedBalance: 1000,
    }),
    (e) => (e as any).status === 404,
  );
  await assert.rejects(
    addHoldingWithCash(
      user,
      { ...stock("005930"), averageCost: null },
      { assetId: krw, expectedBalance: 800 },
    ),
    /거래 단가는 양수/,
  );
  failSnapshot = true;
  await assert.rejects(
    addHoldingWithCash(user, stock("005930"), {
      assetId: krw,
      expectedBalance: 800,
    }),
    /QA snapshot failure/,
  );
  assert.equal((await balance(krw)).balance, 800);
  assert.equal(
    (
      await client.query(
        "select count(*) from portfolio.holdings where user_id=$1 and account_id=$2 and symbol='005930'",
        [user, account],
      )
    ).rows[0].count,
    "0",
  );
  assert.equal(await revision(), initialRevision + 2);
  assert.equal(await flows(), initialFlows);
  await addHoldings(user, [{ ...stock("005930"), averageCost: null }], true);
  assert.equal((await balance(krw)).balance, 800);
  assert.deepEqual(await balance(usd), { balance: 80, basis: 1200 });
  assert.equal(await revision(), initialRevision + 2);
  console.log(
    "PASS: KRW/USD purchases, duplicate prevention, basis, stale/missing/currency/budget checks, atomic rollback and registration without cash; all writes rolled back.",
  );
} finally {
  await client.query("rollback");
  client.release();
  (globalThis as any).portfolioPool = pool;
  await pool.end();
}
