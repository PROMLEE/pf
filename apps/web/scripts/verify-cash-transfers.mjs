import pg from "pg";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(root + ".env.local");
const compile = async (path) =>
  ts.transpileModule(await readFile(root + path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const cash = url(await compile("app/cash-transfer.ts")),
  model = url(await compile("app/portfolio-model.ts"));
const mockdb = url("export const db=()=>globalThis.__cashIntegrationDB;");
const portfolio = url(
  (await compile("lib/portfolio-db.ts"))
    .replace('"./db"', JSON.stringify(mockdb))
    .replace('"../app/portfolio-model"', JSON.stringify(model))
    .replace('"../app/cash-transfer"', JSON.stringify(cash)),
);
const service = url(
  (await compile("lib/cash-transfers-db.ts"))
    .replace('"./db"', JSON.stringify(mockdb))
    .replace('"./portfolio-db"', JSON.stringify(portfolio))
    .replace('"../app/cash-transfer"', JSON.stringify(cash)),
);
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});
await db.connect();
const user = process.env.LOCAL_ADMIN_USER_ID;
const query = async (sql, params) =>
  sql === "begin"
    ? db.query("savepoint transfer_case")
    : sql === "commit"
      ? db.query("release savepoint transfer_case")
      : sql === "rollback"
        ? db.query("rollback to savepoint transfer_case")
        : db.query(sql, params);
globalThis.__cashIntegrationDB = {
  query,
  connect: async () => ({ query, release() {} }),
};
const { applyCashTransfer } = await import(service),
  { listPortfolio, savePortfolioAssets } = await import(portfolio);
await db.query("begin");
try {
  const role = await db.query(
    'select "oauthProvider" from public."User" where "userId"=$1',
    [user],
  );
  assert.equal(role.rows[0].oauthProvider, "GUEST");
  const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID(),
    foreign = (
      await db.query(
        "select id from portfolio.manual_assets where user_id<>$1 limit 1",
        [user],
      )
    ).rows[0]?.id;
  await db.query(
    `insert into portfolio.manual_assets(id,user_id,name,value_krw,value_usd,average_fx_rate) values($1,$4,'TEST 출금',140000,100,1200),($2,$4,'TEST 입금',140000,100,1400),($3,$4,'TEST 원화',10000,null,null)`,
    [a, b, c, user],
  );
  const before = await listPortfolio(user),
    rev = before.cashRevision;
  const request = {
    id: randomUUID(),
    sourceId: a,
    destinationId: b,
    amount: 40,
    note: "test",
    expectedRevision: rev,
  };
  const result = await applyCashTransfer(user, request);
  assert.equal(
    result.portfolio.manualAssets.find((r) => r.id === a).valueUsd,
    60,
  );
  assert.equal(
    result.portfolio.manualAssets.find((r) => r.id === b).valueUsd,
    140,
  );
  assert.equal(result.portfolio.cashRevision, rev + 1);
  const rate = result.portfolio.manualAssets.find(
    (r) => r.id === b,
  ).averageFxRate;
  assert.ok(Math.abs(60 * 1200 + 140 * rate - 260000) < 0.001);
  const replay = await applyCashTransfer(user, request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.portfolio.cashRevision, rev + 1);
  await assert.rejects(
    () => applyCashTransfer(user, { ...request, amount: 30 }),
    /다른 내용/,
  );
  await assert.rejects(
    () => applyCashTransfer(user, { ...request, id: randomUUID() }),
    /변경/,
  );
  await assert.rejects(() => savePortfolioAssets(user, before), /변경/);
  for (const patch of [
    { destinationId: c },
    ...(foreign ? [{ destinationId: foreign }] : []),
    { amount: 10000 },
  ])
    await assert.rejects(() =>
      applyCashTransfer(user, {
        ...request,
        ...patch,
        id: randomUUID(),
        expectedRevision: rev + 1,
      }),
    );
  const count = await db.query(
    "select count(*)::int as n from portfolio.cash_transfers where user_id=$1 and source_id=$2",
    [user, a],
  );
  assert.equal(count.rows[0].n, 1);
  const flowBefore = before.cashFlows.length,
    flowAfter = (await listPortfolio(user)).cashFlows.length;
  assert.equal(flowBefore, flowAfter);
  const saved = await savePortfolioAssets(user, result.portfolio);
  assert.equal(saved.cashRevision, rev + 2);
  // Inject a failure after the first balance update: neither balance nor ledger may commit.
  let updates = 0;
  const failingQuery = async (sql, params) => {
    if (sql.startsWith("update portfolio.manual_assets") && ++updates === 2)
      throw Error("injected second balance failure");
    return query(sql, params);
  };
  globalThis.__cashIntegrationDB.connect = async () => ({
    query: failingQuery,
    release() {},
  });
  await assert.rejects(
    () =>
      applyCashTransfer(user, {
        ...request,
        id: randomUUID(),
        expectedRevision: rev + 2,
      }),
    /injected/,
  );
  const after = await listPortfolio(user);
  assert.equal(after.manualAssets.find((r) => r.id === a).valueUsd, 60);
  assert.equal(after.manualAssets.find((r) => r.id === b).valueUsd, 140);
  assert.equal(after.cashRevision, rev + 2);
  console.log(
    "Live Postgres: atomic transfer, historical USD cost, idempotent replay, stale-save protection, owner/currency/balance checks, no external cash flow, and failure rollback verified.",
  );
} finally {
  await db.query("rollback");
  await db.end();
  console.log("All disposable integration data rolled back.");
}
