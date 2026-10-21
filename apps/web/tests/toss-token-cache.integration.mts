// Synthetic OAuth + real DB. No real provider request; all token rows roll back.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { db } from "../lib/db";
if (process.env.PF_TOSS_TOKEN_DB_TEST !== "1")
  throw Error("Set PF_TOSS_TOKEN_DB_TEST=1 for rollback-only QA");
process.loadEnvFile(".env.local");
const before = {
    id: process.env.TOSS_CLIENT_ID,
    secret: process.env.TOSS_CLIENT_SECRET,
  },
  originalFetch = globalThis.fetch;
process.env.TOSS_CLIENT_ID = `qa-${randomUUID()}`;
process.env.TOSS_CLIENT_SECRET = randomUUID();
const key = createHash("sha256")
  .update(
    `toss-token\0https://openapi.tossinvest.com\0${process.env.TOSS_CLIENT_ID}\0${process.env.TOSS_CLIENT_SECRET}`,
  )
  .digest("hex");
const pool = db(),
  client = await pool.connect();
let issued = 0;
await client.query("begin");
const proxy = {
  query: async (sql: any, args?: any[]) => {
    if (sql === "begin") return client.query("savepoint toss_token_qa");
    if (sql === "commit")
      return client.query("release savepoint toss_token_qa");
    if (sql === "rollback") {
      await client.query("rollback to savepoint toss_token_qa");
      return client.query("release savepoint toss_token_qa");
    }
    return client.query(sql, args);
  },
  release() {},
};
(globalThis as any).portfolioPool = {
  query: proxy.query,
  connect: async () => proxy,
};
globalThis.fetch = async () => {
  issued++;
  return Response.json({
    access_token: `qa-fake-token-${issued}`,
    expires_in: 86400,
  });
};
try {
  const first = await import(
    new URL(`../lib/toss-auth.ts?qa=${randomUUID()}`, import.meta.url).href
  );
  const tokens = await Promise.all(
    Array.from({ length: 8 }, () => first.tossToken()),
  );
  assert.ok(tokens.every((x) => x === "qa-fake-token-1"));
  assert.equal(issued, 1);
  const row = (
    await client.query(
      "select token_ciphertext from portfolio.market_data_tokens where cache_key=$1",
      [key],
    )
  ).rows[0];
  assert.ok(row);
  assert.ok(!row.token_ciphertext.includes("qa-fake-token"));
  const cold = await import(
    new URL(`../lib/toss-auth.ts?qa=${randomUUID()}`, import.meta.url).href
  );
  assert.equal(await cold.tossToken(), "qa-fake-token-1");
  assert.equal(issued, 1);
  assert.equal(await cold.tossToken("qa-fake-token-1"), "qa-fake-token-2");
  assert.equal(issued, 2);
  console.log(
    "PASS: encrypted real DB cache, simultaneous issue suppression, cold reuse and token rejection rotation; rollback only, no real Toss calls.",
  );
} finally {
  await client.query("rollback");
  assert.equal(
    (
      await client.query(
        "select count(*) from portfolio.market_data_tokens where cache_key=$1",
        [key],
      )
    ).rows[0].count,
    "0",
  );
  client.release();
  (globalThis as any).portfolioPool = pool;
  await pool.end();
  globalThis.fetch = originalFetch;
  for (const [k, v] of [
    ["TOSS_CLIENT_ID", before.id],
    ["TOSS_CLIENT_SECRET", before.secret],
  ])
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
}
