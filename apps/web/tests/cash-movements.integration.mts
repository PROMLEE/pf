// Opt-in GUEST-only integration. Every ledger, balance and snapshot change rolls back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { applyCashTransfer } from "../lib/cash-transfers-db";
import {
  listPortfolio,
  deleteCashFlow,
  updateCashFlow,
  restoreCashFlow,
} from "../lib/portfolio-db";
if (process.env.PF_CASH_DB_TEST !== "1")
  throw Error("Set PF_CASH_DB_TEST=1 for rollback-only QA");
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
const proxy = {
  query: async (sql: any, args?: any[]) => {
    if (sql === "begin") return client.query("savepoint cash_qa");
    if (sql === "commit") return client.query("release savepoint cash_qa");
    if (sql === "rollback") {
      await client.query("rollback to savepoint cash_qa");
      return client.query("release savepoint cash_qa");
    }
    return client.query(sql, args);
  },
  release() {},
};
(globalThis as any).portfolioPool = {
  query: proxy.query,
  connect: async () => proxy,
};
const a = randomUUID(),
  b = randomUUID(),
  usd = randomUUID();
try {
  await client.query(
    "update portfolio.plans set usd_krw=1400 where user_id=$1",
    [user],
  );
  await client.query(
    `insert into portfolio.manual_assets(id,user_id,name,value_krw,value_usd,average_fx_rate) values($1,$4,'QA 현금 A',1000,null,null),($2,$4,'QA 현금 B',50,null,null),($3,$4,'QA 달러',14000,10,1200)`,
    [a, b, usd, user],
  );
  const revision = async () =>
    Number(
      (
        await client.query(
          "select cash_revision from portfolio.plans where user_id=$1",
          [user],
        )
      ).rows[0].cash_revision,
    );
  const asset = async (id: string) =>
    (
      await client.query(
        "select value_krw,value_usd,average_fx_rate from portfolio.manual_assets where user_id=$1 and id=$2",
        [user, id],
      )
    ).rows[0];
  const apply = async (
    kind: "deposit" | "withdrawal" | "transfer",
    sourceId: string | null,
    destinationId: string | null,
    amount: number,
    fxRate: number | null = null,
  ) => {
    const input = {
      id: randomUUID(),
      kind,
      sourceId,
      destinationId,
      amount,
      fxRate,
      note: "QA",
      expectedRevision: await revision(),
    };
    return { input, result: await applyCashTransfer(user, input) };
  };
  const dep = await apply("deposit", null, a, 500);
  assert.equal(Number((await asset(a)).value_krw), 1500);
  assert.equal(
    dep.result.portfolio?.cashFlows.find((f) => f.id === dep.input.id)
      ?.amountKrw,
    500,
  );
  assert.equal(
    dep.result.portfolio?.cashFlows.find((f) => f.id === dep.input.id)
      ?.balanceLinked,
    true,
  );
  const rev = await revision();
  assert.equal((await applyCashTransfer(user, dep.input)).replayed, true);
  assert.equal(await revision(), rev);
  assert.equal(Number((await asset(a)).value_krw), 1500);
  await assert.rejects(
    () => applyCashTransfer(user, { ...dep.input, amount: 501 }),
    /다른 내용/,
  );
  await assert.rejects(
    () =>
      applyCashTransfer(user, {
        ...dep.input,
        id: randomUUID(),
        expectedRevision: rev - 1,
      }),
    /잔액 정보/,
  );
  await apply("withdrawal", a, null, 200);
  assert.equal(Number((await asset(a)).value_krw), 1300);
  const beforeFail = await revision();
  await assert.rejects(() => apply("withdrawal", a, null, 2000), /부족/);
  assert.equal(await revision(), beforeFail);
  const internal = await apply("transfer", a, b, 100);
  assert.equal(Number((await asset(a)).value_krw), 1200);
  assert.equal(Number((await asset(b)).value_krw), 150);
  assert.ok(
    !internal.result.portfolio?.cashFlows.some(
      (f) => f.id === internal.input.id,
    ),
  );
  const dollar = await apply("deposit", null, usd, 100, 1400);
  assert.equal(Number((await asset(usd)).value_usd), 110);
  assert.equal(Number((await asset(usd)).average_fx_rate), 1381.818182);
  assert.equal(
    dollar.result.portfolio?.cashFlows.find((f) => f.id === dollar.input.id)
      ?.amountKrw,
    140000,
  );
  await apply("withdrawal", usd, null, 20);
  assert.equal(Number((await asset(usd)).value_usd), 90);
  assert.equal(Number((await asset(usd)).average_fx_rate), 1381.818182);
  await assert.rejects(() => apply("transfer", a, usd, 1), /동일한 통화/);
  await assert.rejects(() => apply("deposit", null, a, 100, 1400), /달러 입금/);
  await assert.rejects(
    () => apply("deposit", null, randomUUID(), 100),
    /찾지 못/,
  );
  await assert.rejects(() => deleteCashFlow(user, dep.input.id), /잔액과 함께/);
  await assert.rejects(
    () => restoreCashFlow(user, dep.input.id),
    /잔액과 함께/,
  );
  await assert.rejects(
    () =>
      updateCashFlow(user, {
        id: dep.input.id,
        date: "2026-10-20",
        amountKrw: 1,
        note: "tamper",
      }),
    /잔액과 함께/,
  );
  const flow = (
    await client.query(
      "select occurred_at,created_at from portfolio.cash_flows where user_id=$1 and id=$2",
      [user, dep.input.id],
    )
  ).rows[0];
  assert.equal(+flow.occurred_at, +flow.created_at);
  assert.ok(await listPortfolio(user));
  console.log(
    "PASS: GUEST deposits/withdrawals/transfer, FX basis, owner checks, duplicate/stale retries, linked flow protection. All changes roll back.",
  );
} finally {
  await client.query("rollback");
  (globalThis as any).portfolioPool = pool;
  client.release();
  await pool.end();
}
