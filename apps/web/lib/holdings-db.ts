import type { PoolClient } from "pg";
import type { Holding } from "../app/holdings";
import { db } from "./db";
import { recordSnapshot } from "./portfolio-db";

type Row = {
  id: string;
  broker: string;
  account_label: string;
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
    `select id, broker, account_label, market, name, symbol, exchange_code, bucket_id, assignment_source, quantity, captured_price, average_cost, captured_at, current_price, quote_label, quote_checked_at
     from portfolio.holdings where user_id = $1 order by created_at desc, name asc`,
    [userId],
  );
  return result.rows.map(fromRow);
}

export async function listHoldings(userId: string) {
  return select(db(), userId);
}

export async function addHoldings(userId: string, incoming: Holding[]) {
  const client = await db().connect();
  try {
    await client.query("begin");
    for (const row of incoming) {
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
         (id, user_id, broker, account_label, market, name, symbol, exchange_code, bucket_id, assignment_source, quantity, captured_price, average_cost, captured_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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
