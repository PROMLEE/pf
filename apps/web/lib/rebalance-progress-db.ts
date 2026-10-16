import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  runItemProgress,
  type RebalanceRun,
  type RunFill,
  type RunOutcome,
  type RunSnapshot,
} from "../app/rebalance-runs";
import type { PositionTrade } from "../app/position-trade";
type Client = Pick<PoolClient, "query">;
export type RunRow = {
  id: string;
  status: RebalanceRun["status"];
  revision: number;
  snapshot: RunSnapshot;
  outcome: RunOutcome | null;
  created_at: Date;
  ended_at: Date | null;
};
export async function readRunFills(
  client: Client,
  userId: string,
  runId: string,
): Promise<RunFill[]> {
  const result = await client.query<{
    id: string;
    item_id: string;
    holding_id: string | null;
    quantity: string;
    price: string;
    fee: string;
    currency: "KRW" | "USD";
    fx_rate: string;
    source: RunFill["source"];
    created_at: Date;
  }>(
    `select * from portfolio.rebalance_fills where user_id=$1 and run_id=$2 order by created_at,id`,
    [userId, runId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    holdingId: r.holding_id,
    quantity: Number(r.quantity),
    price: Number(r.price),
    fee: Number(r.fee),
    currency: r.currency,
    fxRate: Number(r.fx_rate),
    source: r.source,
    createdAt: r.created_at.toISOString(),
  }));
}
export async function runFromRow(
  client: Client,
  userId: string,
  row: RunRow,
): Promise<RebalanceRun> {
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    snapshot: row.snapshot,
    outcome: row.outcome,
    createdAt: row.created_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    fills: await readRunFills(client, userId, row.id),
  };
}
export async function appendRunFill(
  client: Client,
  userId: string,
  row: RunRow,
  fill: Omit<RunFill, "createdAt">,
  payloadHash: string | null,
  outcome: () => Promise<RunOutcome>,
) {
  await client.query(
    `insert into portfolio.rebalance_fills(id,user_id,run_id,item_id,holding_id,quantity,price,fee,currency,fx_rate,source,payload_hash) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      fill.id,
      userId,
      row.id,
      fill.itemId,
      fill.holdingId,
      fill.quantity,
      fill.price,
      fill.fee,
      fill.currency,
      fill.fxRate,
      fill.source,
      payloadHash,
    ],
  );
  const fills = await readRunFills(client, userId, row.id);
  const complete = row.snapshot.items.every(
    (item) => runItemProgress(item, fills).done,
  );
  const result = complete ? await outcome() : null;
  await client.query(
    `update portfolio.rebalance_runs set revision=revision+1,status=$3,ended_at=case when $3='completed' then now() else null end,outcome=$4 where user_id=$1 and id=$2`,
    [
      userId,
      row.id,
      complete ? "completed" : "active",
      result ? JSON.stringify(result) : null,
    ],
  );
}
/** Called after a normal stock trade, inside the SAME transaction. */
export async function recordActiveRunStockFill(
  client: Client,
  userId: string,
  holdingId: string,
  trade: PositionTrade,
  market: "KR" | "US",
  fxRate: number,
  outcome: (snapshot: RunSnapshot) => Promise<RunOutcome>,
) {
  const found = await client.query<RunRow>(
    `select * from portfolio.rebalance_runs where user_id=$1 and status='active' for update`,
    [userId],
  );
  const row = found.rows[0];
  if (!row) return false;
  const fills = await readRunFills(client, userId, row.id);
  const item = row.snapshot.items.find(
    (i) =>
      i.kind === "stock" &&
      i.side === trade.side &&
      i.market === market &&
      (i.holdingId === holdingId ||
        fills.some((f) => f.itemId === i.id && f.holdingId === holdingId)) &&
      !runItemProgress(i, fills).done,
  );
  if (!item) return false;
  await appendRunFill(
    client,
    userId,
    row,
    {
      id: randomUUID(),
      itemId: item.id,
      holdingId,
      quantity: trade.quantity,
      price: trade.price,
      fee: trade.fee,
      currency: item.currency,
      fxRate,
      source: "holding-editor",
    },
    null,
    () => outcome(row.snapshot),
  );
  return true;
}
