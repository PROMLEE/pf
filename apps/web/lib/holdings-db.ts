import type { PoolClient } from "pg";
import type { Holding } from "../app/holdings";
import { db } from "./db";
import { resolveAccount } from "./accounts-db";
import { recordSnapshot } from "./portfolio-db";

type Row = {
  id: string;
  broker: string;
  account_label: string;
  account_id: string;
  market: "KR" | "US";
  name: string;
  symbol: string;
  exchange_code: string | null;
  bucket_id: string | null;
  assignment_source: "auto" | "manual";
  quantity: string;
  captured_price: string | null;
  average_cost: string | null;
  captured_at: Date;
  current_price: string | null;
  quote_label: string | null;
  quote_checked_at: Date | null;
};

function fromRow(row: Row): Holding {
  return {
    id: row.id,
    broker: row.broker,
    account: row.account_label,
    accountId: row.account_id,
    market: row.market,
    name: row.name,
    symbol: row.symbol,
    exchange: row.exchange_code,
    bucketId: row.bucket_id,
    assignmentSource: row.assignment_source,
    quantity: Number(row.quantity),
    capturedPrice:
      row.captured_price === null ? null : Number(row.captured_price),
    averageCost: row.average_cost === null ? null : Number(row.average_cost),
    capturedAt: row.captured_at.toISOString(),
    currentPrice: row.current_price === null ? null : Number(row.current_price),
    quoteLabel: row.quote_label,
    quoteCheckedAt: row.quote_checked_at?.toISOString() ?? null,
  };
}

async function select(client: Pick<PoolClient, "query">, userId: string) {
  const result = await client.query<Row>(
    `select id, broker, account_label, account_id, market, name, symbol, exchange_code, bucket_id, assignment_source, quantity, captured_price, average_cost, captured_at, current_price, quote_label, quote_checked_at
     from portfolio.holdings where user_id = $1 order by created_at desc, name asc`,
    [userId],
  );
  return result.rows.map(fromRow);
}

export async function listHoldings(userId: string) {
  return select(db(), userId);
}

export async function addHoldings(
  userId: string,
  incoming: Holding[],
  insertOnly = false,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    for (const input of incoming) {
      const account = await resolveAccount(
        client,
        userId,
        input.broker,
        input.account,
        input.accountId,
      );
      const row = {
        ...input,
        broker: account.broker,
        account: account.name,
        accountId: account.id,
      };
      if (insertOnly) {
        const duplicate = await client.query(
          `select id from portfolio.holdings where user_id=$1 and account_id=$2 and market=$3 and symbol=$4`,
          [userId, account.id, row.market, row.symbol],
        );
        if (duplicate.rowCount)
          throw new Error(
            "이미 보유한 종목입니다. 기존 종목의 수량을 수정해 주세요.",
          );
      }
      let previousAssignment:
        | { bucket_id: string | null; assignment_source: "auto" | "manual" }
        | undefined;
      if (row.symbol) {
        const deleted = await client.query<{
          bucket_id: string | null;
          assignment_source: "auto" | "manual";
        }>(
          `delete from portfolio.holdings where user_id = $1 and lower(broker) = lower($2) and lower(account_label) = lower($3) and market = $4 and symbol = $5 and (exchange_code is not distinct from $6 or exchange_code is null or $6::text is null) returning bucket_id, assignment_source`,
          [
            userId,
            row.broker,
            row.account,
            row.market,
            row.symbol,
            row.exchange ?? null,
          ],
        );
        previousAssignment = deleted.rows[0];
      }
      const matchedRule = row.symbol
        ? await client.query<{ bucket_id: string }>(
            `select bucket_id from portfolio.rules where user_id = $1 and market = $2 and symbol = $3 limit 1`,
            [userId, row.market, row.symbol],
          )
        : null;
      const manual = previousAssignment?.assignment_source === "manual";
      const bucketId = manual
        ? (previousAssignment?.bucket_id ?? null)
        : (matchedRule?.rows[0]?.bucket_id ?? null);
      await client.query(
        `insert into portfolio.holdings
         (id, user_id, broker, account_label, market, name, symbol, exchange_code, bucket_id, assignment_source, quantity, captured_price, average_cost, captured_at, account_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          crypto.randomUUID(),
          userId,
          row.broker,
          row.account,
          row.market,
          row.name,
          row.symbol,
          row.exchange ?? null,
          bucketId,
          manual ? "manual" : "auto",
          row.quantity,
          row.capturedPrice,
          row.averageCost,
          row.capturedAt,
          row.accountId,
        ],
      );
    }
    await recordSnapshot(userId, client);
    const rows = await select(client, userId);
    await client.query("commit");
    return rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeHolding(userId: string, id: string) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from portfolio.holdings where user_id = $1 and id = $2`,
      [userId, id],
    );
    await recordSnapshot(userId, client);
    const rows = await select(client, userId);
    await client.query("commit");
    return rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateHoldingAmounts(
  userId: string,
  id: string,
  quantity: number,
  averageCost: number | null,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update portfolio.holdings
       set quantity = $3, average_cost = $4, updated_at = now()
       where user_id = $1 and id = $2`,
      [userId, id, quantity, averageCost],
    );
    if (result.rowCount !== 1)
      throw new Error("수정할 자산을 찾지 못했습니다.");
    await recordSnapshot(userId, client);
    const rows = await select(client, userId);
    await client.query("commit");
    return rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateHoldingInstrument(
  userId: string,
  id: string,
  instrument: {
    market: "KR" | "US";
    name: string;
    symbol: string;
    exchange: string;
  },
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `update portfolio.holdings
     set name = $3, symbol = $4, exchange_code = $5, current_price = null,
         bucket_id = case when assignment_source = 'manual' then bucket_id
           else (select bucket_id from portfolio.rules where user_id = $1 and market = $6 and symbol = $4) end,
         quote_label = null, quote_checked_at = null, updated_at = now()
     where user_id = $1 and id = $2 and market = $6`,
      [
        userId,
        id,
        instrument.name,
        instrument.symbol,
        instrument.exchange,
        instrument.market,
      ],
    );
    await recordSnapshot(userId, client);
    const rows = await select(client, userId);
    await client.query("commit");
    return rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function setQuote(
  userId: string,
  market: "KR" | "US",
  symbol: string,
  exchange: string | null,
  price: number,
  label: string,
  checkedAt: string,
) {
  await db().query(
    `update portfolio.holdings set current_price = $5, quote_label = $6, quote_checked_at = $7, updated_at = now()
     where user_id = $1 and market = $2 and symbol = $3 and exchange_code is not distinct from $4`,
    [userId, market, symbol, exchange, price, label, checkedAt],
  );
}

export async function updateHoldingAssignment(
  userId: string,
  id: string,
  bucketId: string | null,
  source: "auto" | "manual",
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update portfolio.holdings h set
      assignment_source = $4,
      bucket_id = case when $4 = 'auto' then (select r.bucket_id from portfolio.rules r where r.user_id = $1 and r.market = h.market and r.symbol = h.symbol limit 1) else $3 end,
      updated_at = now()
      where h.user_id = $1 and h.id = $2 and ($3::uuid is null or exists(select 1 from portfolio.buckets b where b.user_id = $1 and b.id = $3))`,
      [userId, id, bucketId, source],
    );
    if (result.rowCount !== 1) {
      await client.query("rollback");
      return null;
    }
    const snapshots = await recordSnapshot(userId, client);
    const holdings = await select(client, userId);
    await client.query("commit");
    return { holdings, snapshots };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function moveHoldingAccount(
  userId: string,
  id: string,
  accountId: string,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const account = await resolveAccount(client, userId, "", "", accountId);
    const owned = await client.query<{ market: string; symbol: string }>(
      `select market,symbol from portfolio.holdings where user_id=$1 and id=$2 for update`,
      [userId, id],
    );
    if (!owned.rows[0]) {
      await client.query("rollback");
      return null;
    }
    const duplicate = await client.query(
      `select id from portfolio.holdings where user_id=$1 and account_id=$2 and market=$3 and symbol=$4 and id<>$5 and symbol<>''`,
      [userId, accountId, owned.rows[0].market, owned.rows[0].symbol, id],
    );
    if (duplicate.rowCount)
      throw new Error(
        "옮길 계좌에 같은 종목이 있습니다. 수량을 확인해 각각 수정해 주세요.",
      );
    await client.query(
      `update portfolio.holdings set account_id=$3,broker=$4,account_label=$5,updated_at=now() where user_id=$1 and id=$2`,
      [userId, id, accountId, account.broker, account.name],
    );
    await recordSnapshot(userId, client);
    const holdings = await select(client, userId);
    await client.query("commit");
    return { holdings };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
