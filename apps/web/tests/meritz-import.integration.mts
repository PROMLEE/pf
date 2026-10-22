// Real PostgreSQL + synthetic broker response. All mutations roll back, no real owner writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
if (process.env.PF_MERITZ_DB_TEST !== "1")
  throw Error("Set PF_MERITZ_DB_TEST=1 for rollback-only QA");
process.loadEnvFile(".env.local");
const user = process.env.LOCAL_ADMIN_USER_ID!;
if (!user || user === "cmmxdq76o0001hu65aj4wubvy")
  throw Error("Use a disposable QA user");
process.env.MERITZ_APP_KEY = "qa-" + randomUUID();
process.env.MERITZ_APP_SECRET = randomUUID();
process.env.MERITZ_USER_ID = user;
const pool = db(),
  client = await pool.connect(),
  oldFetch = globalThis.fetch;
await client.query("begin");
let failCash = false;
const proxy = {
  query: async (sql: any, args?: any[]) => {
    if (sql === "begin") return client.query("savepoint meritz_test");
    if (sql === "commit") return client.query("release savepoint meritz_test");
    if (sql === "rollback") {
      await client.query("rollback to savepoint meritz_test");
      return client.query("release savepoint meritz_test");
    }
    if (failCash && sql.startsWith("update portfolio.manual_assets")) {
      failCash = false;
      throw Error("QA injected cash failure");
    }
    return client.query(sql, args);
  },
  release() {},
};
(globalThis as any).portfolioPool = {
  query: proxy.query,
  connect: async () => proxy,
};
let tokens = 0,
  requests = 0,
  omitDomestic = false,
  remoteFailure = false,
  unsupported = false;
globalThis.fetch = async (input: any) => {
  const path = new URL(String(input)).pathname;
  requests++;
  if (remoteFailure) throw Error("QA network failure");
  if (path === "/oauth2/token") {
    tokens++;
    return Response.json({ access_token: "qa-token", expires_in: 43200 });
  }
  let data: any;
  if (path === "/accounts/v1/me/holdings")
    data = [
      {
        pros_trgt_cls_code: "1",
        iscd: "A005930",
        isnm: "삼성전자",
        rmnd_qty: "12",
        byng_unpr: "1000",
        psnt_prc: "1200",
      },
    ];
  else if (path === "/accounts/v1/me/overseas/holdings")
    data = [
      {
        crcd: "USD",
        rmnd_clcd: "1",
        iscd: "MSFT.OQ",
        ovrs_stck_symb_iscd: "MSFT",
        isnm: "마이크로소프트",
        rmnd_dqty: "3",
        avrg_unpr: "200",
        psnt_prc: "250",
      },
    ];
  else if (path === "/accounts/v1/me/deposit") data = { d2_aft_tfam: "800" };
  else if (path === "/accounts/v1/me/overseas/currencies")
    data = [{ crcd: "USD", estm_frcr_amt: "25" }];
  else throw Error("Unexpected API " + path);
  if (omitDomestic && path === "/accounts/v1/me/holdings") data = [];
  if (unsupported && path === "/accounts/v1/me/overseas/holdings")
    data.push({ ...data[0], crcd: "EUR" });
  return Response.json({ rsp_cd: "5766", data, tr_cont: "0" });
};
try {
  const account = randomUUID(),
    cash = randomUUID(),
    holding = randomUUID(),
    bucket = (
      await client.query(
        "select id from portfolio.buckets where user_id=$1 limit 1",
        [user],
      )
    ).rows[0]?.id;
  assert.ok(bucket, "QA portfolio needs a bucket");
  await client.query(
    "insert into portfolio.accounts(id,user_id,broker,name) values($1,$2,$3,$4)",
    [account, user, "메리츠증권", "QA-" + randomUUID()],
  );
  await client.query(
    "insert into portfolio.holdings(id,user_id,account_id,broker,account_label,market,symbol,name,quantity,average_cost,average_cost_krw,bucket_id,assignment_source,captured_at) values($1,$2,$3,'메리츠증권','QA','US','MSFT','마이크로소프트',2,100,130000,$4,'manual',now())",
    [holding, user, account, bucket],
  );
  await client.query(
    "insert into portfolio.manual_assets(id,user_id,account_id,name,value_krw,value_usd,average_fx_rate,bucket_id) values($1,$2,$3,$4,13000,10,1300,$5)",
    [cash, user, account, "QA dollars", bucket],
  );
  const api = await import("../lib/meritz-import");
  const opts = { accountId: account, krwAssetId: "new", usdAssetId: cash };
  const preview = await api.createMeritzPreview(user, opts);
  assert.equal(preview.changes.length, 4);
  assert.equal(
    (
      await client.query(
        "select quantity from portfolio.holdings where id=$1",
        [holding],
      )
    ).rows[0].quantity,
    "2.000000",
  );
  await assert.rejects(api.applyMeritzPreview(user, preview.token, ["bad"]));
  await assert.rejects(
    api.applyMeritzPreview(
      "foreign",
      preview.token,
      preview.changes.map((c) => c.key),
    ),
  );
  failCash = true;
  await assert.rejects(
    api.applyMeritzPreview(
      user,
      preview.token,
      preview.changes.map((c) => c.key),
    ),
    /injected/,
  );
  assert.equal(
    Number(
      (
        await client.query(
          "select quantity from portfolio.holdings where id=$1",
          [holding],
        )
      ).rows[0].quantity,
    ),
    2,
  );
  assert.equal(
    (
      await client.query(
        "select id from portfolio.holdings where user_id=$1 and account_id=$2",
        [user, account],
      )
    ).rowCount,
    1,
  );
  const applied = await api.applyMeritzPreview(
    user,
    preview.token,
    preview.changes.map((c) => c.key),
  );
  assert.equal(applied.count, 4);
  assert.equal(tokens, 1);
  const changed = applied.holdings.find((h) => h.id === holding)!;
  assert.equal(changed.quantity, 3);
  assert.equal(changed.averageCost, 200);
  assert.equal(changed.averageCostKrw, 260000);
  assert.equal(changed.bucketId, bucket);
  assert.equal(changed.assignmentSource, "manual");
  const dollars = applied.portfolio!.manualAssets.find((c) => c.id === cash)!;
  assert.equal(dollars.valueUsd, 25);
  assert.equal(dollars.averageFxRate, 1300);
  assert.equal(dollars.bucketId, bucket);
  await assert.rejects(
    api.applyMeritzPreview(
      user,
      preview.token,
      preview.changes.map((c) => c.key),
    ),
  );
  const repeat = await api.createMeritzPreview(user, {
    ...opts,
    krwAssetId: "skip",
  });
  assert.equal(repeat.changes.length, 0);
  assert.equal(tokens, 1);
  const stale = await api.createMeritzPreview(user, {
    ...opts,
    krwAssetId: "skip",
  });
  await client.query("update portfolio.holdings set quantity=4 where id=$1", [
    holding,
  ]);
  const signed = api.signPreview({
    ...api.readPreview(stale.token, user),
    changes: preview.changes.filter((c) => c.key === "stock:US:MSFT"),
  });
  await assert.rejects(
    api.applyMeritzPreview(user, signed, ["stock:US:MSFT"]),
    /변경/,
  );
  const syncApi = await import("../lib/meritz-sync");
  const krw = applied.portfolio!.manualAssets.find(
    (c) => c.accountId === account && c.valueUsd === null,
  )!;
  await syncApi.configureMeritzSync(user, account, krw.id, cash);
  await client.query(
    "update portfolio.meritz_sync set lease_id=$2,lease_until=now()+interval '1 minute',last_attempt_at=null where user_id=$1",
    [user, randomUUID()],
  );
  const noClaimRequests = requests;
  assert.equal((await syncApi.syncMeritzBalance(user)).state, "busy");
  assert.equal(requests, noClaimRequests);
  await client.query(
    "update portfolio.meritz_sync set lease_until=now()-interval '1 second' where user_id=$1",
    [user],
  );
  const auto = await syncApi.syncMeritzBalance(user);
  assert.equal(auto.state, "synced");
  assert.equal(
    Number(
      (
        await client.query(
          "select quantity from portfolio.holdings where id=$1",
          [holding],
        )
      ).rows[0].quantity,
    ),
    3,
  );
  const beforeRequests = requests;
  assert.equal((await syncApi.syncMeritzBalance(user)).state, "cached");
  assert.equal(requests, beforeRequests);
  await syncApi.setMeritzSyncEnabled(user, false);
  assert.equal((await syncApi.syncMeritzBalance(user)).state, "disabled");
  await syncApi.setMeritzSyncEnabled(user, true);
  remoteFailure = true;
  assert.equal((await syncApi.syncMeritzBalance(user)).state, "error");
  assert.equal(
    Number(
      (
        await client.query(
          "select quantity from portfolio.holdings where id=$1",
          [holding],
        )
      ).rows[0].quantity,
    ),
    3,
  );
  remoteFailure = false;
  await client.query(
    "update portfolio.meritz_sync set last_attempt_at=null where user_id=$1",
    [user],
  );
  unsupported = true;
  assert.equal((await syncApi.syncMeritzBalance(user)).state, "error");
  assert.equal(
    (
      await client.query(
        "select id from portfolio.holdings where user_id=$1 and account_id=$2",
        [user, account],
      )
    ).rowCount,
    2,
  );
  unsupported = false;
  omitDomestic = true;
  await client.query(
    "update portfolio.meritz_sync set last_attempt_at=null where user_id=$1",
    [user],
  );
  const sale = await syncApi.syncMeritzBalance(user);
  assert.equal(sale.state, "synced");
  assert.equal(
    (
      await client.query(
        "select id from portfolio.holdings where user_id=$1 and account_id=$2",
        [user, account],
      )
    ).rowCount,
    1,
  );
  assert.equal(sale.sync.count, 1);
  assert.equal(tokens, 1);
  // Asset editing deletes then reinserts cash rows in one transaction; deferred links must permit it.
  await client.query("savepoint cash_replace");
  const savedCash = (
    await client.query(
      "delete from portfolio.manual_assets where id=$1 returning *",
      [cash],
    )
  ).rows[0];
  await client.query(
    "insert into portfolio.manual_assets select * from jsonb_populate_record(null::portfolio.manual_assets,$1::jsonb)",
    [JSON.stringify(savedCash)],
  );
  await client.query("set constraints all immediate");
  await client.query("rollback to savepoint cash_replace");
  console.log(
    "PASS: auto sync, throttle, pause/resume, failed/partial fetch preservation, fully sold removal, deferred cash references; preview read-only; atomic stocks+cash; assignments/FX retained; repeat/stale/foreign rejected; token reused. All QA changes roll back.",
  );
} finally {
  globalThis.fetch = oldFetch;
  await client.query("rollback");
  client.release();
  (globalThis as any).portfolioPool = pool;
  await pool.end();
}
