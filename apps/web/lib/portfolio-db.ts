import type { PoolClient } from "pg";
import type {
  Assignment,
  Bucket,
  CashFlow,
  ManualAsset,
  Portfolio,
  Rule,
  Snapshot,
} from "../app/portfolio-model";
import { db } from "./db";

type Client = Pick<PoolClient, "query">;
type PlanRow = {
  title: string;
  usd_krw: string;
  usd_krw_updated_at: Date;
  tolerance_percent: string;
};
type CashFlowRow = {
  id: string;
  flow_date: string;
  amount_krw: string;
  note: string;
};
type BucketRow = {
  id: string;
  name: string;
  target_percent: string;
  color: string;
};
type RuleRow = {
  id: string;
  bucket_id: string;
  market: "KR" | "US";
  symbol: string;
  exchange_code: string | null;
  name: string;
  manual_price: string | null;
  quoted_price: string | null;
  quote_checked_at: Date | null;
};
type ManualRow = {
  id: string;
  bucket_id: string | null;
  name: string;
  value_krw: string;
};
type AssignmentRow = {
  id: string;
  bucket_id: string | null;
  assignment_source: "auto" | "manual";
};
type SnapshotRow = {
  snapshot_date: string;
  bucket_key: string;
  bucket_name: string;
  value_krw: string;
  target_percent: string | null;
};

export async function listPortfolio(
  userId: string,
  client: Client = db(),
): Promise<Portfolio | null> {
  const plan = await client.query<PlanRow>(
    `select title, usd_krw, usd_krw_updated_at, tolerance_percent from portfolio.plans where user_id = $1`,
    [userId],
  );
  if (!plan.rows[0]) return null;
  const buckets = await client.query<BucketRow>(
    `select id, name, target_percent, color from portfolio.buckets where user_id = $1 order by position, name`,
    [userId],
  );
  const rules = await client.query<RuleRow>(
    `select id, bucket_id, market, symbol, exchange_code, name, manual_price, quoted_price, quote_checked_at
       from portfolio.rules where user_id = $1 order by position, symbol`,
    [userId],
  );
  const manualAssets = await client.query<ManualRow>(
    `select id, bucket_id, name, value_krw from portfolio.manual_assets where user_id = $1 order by name`,
    [userId],
  );
  const assignments = await client.query<AssignmentRow>(
    `select id, bucket_id, assignment_source from portfolio.holdings where user_id = $1`,
    [userId],
  );
  const snapshots = await client.query<SnapshotRow>(
    `select snapshot_date::text, bucket_key, bucket_name, value_krw, target_percent
       from portfolio.snapshots where user_id = $1 order by snapshot_date, bucket_key`,
    [userId],
  );
  const cashFlows = await client.query<CashFlowRow>(
    `select id, flow_date::text, amount_krw, note from portfolio.cash_flows where user_id = $1 order by flow_date desc, created_at desc`,
    [userId],
  );
  return {
    title: plan.rows[0].title,
    usdKrw: Number(plan.rows[0].usd_krw),
    usdKrwUpdatedAt: plan.rows[0].usd_krw_updated_at.toISOString(),
    tolerancePercent: Number(plan.rows[0].tolerance_percent),
    buckets: buckets.rows.map(
      (row): Bucket => ({
        id: row.id,
        name: row.name,
        targetPercent: Number(row.target_percent),
        color: row.color,
      }),
    ),
    rules: rules.rows.map(
      (row): Rule => ({
        id: row.id,
        bucketId: row.bucket_id,
        market: row.market,
        symbol: row.symbol,
        exchange: row.exchange_code,
        name: row.name,
        manualPrice:
          row.manual_price === null ? null : Number(row.manual_price),
        quotedPrice:
          row.quoted_price === null ? null : Number(row.quoted_price),
        quoteCheckedAt: row.quote_checked_at?.toISOString() ?? null,
      }),
    ),
    manualAssets: manualAssets.rows.map(
      (row): ManualAsset => ({
        id: row.id,
        bucketId: row.bucket_id,
        name: row.name,
        valueKrw: Number(row.value_krw),
      }),
    ),
    assignments: assignments.rows.map(
      (row): Assignment => ({
        holdingId: row.id,
        bucketId: row.bucket_id,
        source: row.assignment_source,
      }),
    ),
    snapshots: snapshots.rows.map(
      (row): Snapshot => ({
        date: row.snapshot_date,
        bucketKey: row.bucket_key,
        bucketName: row.bucket_name,
        valueKrw: Number(row.value_krw),
        targetPercent:
          row.target_percent === null ? null : Number(row.target_percent),
      }),
    ),
    cashFlows: cashFlows.rows.map(
      (row): CashFlow => ({
        id: row.id,
        date: row.flow_date,
        amountKrw: Number(row.amount_krw),
        note: row.note,
      }),
    ),
  };
}

export async function savePortfolio(userId: string, input: Portfolio) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into portfolio.plans (user_id, title, usd_krw, tolerance_percent)
       values ($1,$2,$3,$4)
       on conflict (user_id) do update set title = excluded.title, usd_krw = excluded.usd_krw,
         usd_krw_updated_at = case when portfolio.plans.usd_krw is distinct from excluded.usd_krw then now() else portfolio.plans.usd_krw_updated_at end,
         tolerance_percent = excluded.tolerance_percent, updated_at = now()`,
      [userId, input.title, input.usdKrw, input.tolerancePercent],
    );
    const previousPrices = await client.query<{
      market: string;
      symbol: string;
      quoted_price: string | null;
      quote_checked_at: Date | null;
    }>(
      `select market, symbol, quoted_price, quote_checked_at from portfolio.rules where user_id = $1`,
      [userId],
    );
    const prices = new Map(
      previousPrices.rows.map((row) => [`${row.market}:${row.symbol}`, row]),
    );
    await client.query(
      `delete from portfolio.manual_assets where user_id = $1`,
      [userId],
    );
    await client.query(
      `update portfolio.holdings set bucket_id = null, assignment_source = 'auto' where user_id = $1`,
      [userId],
    );
    await client.query(`delete from portfolio.buckets where user_id = $1`, [
      userId,
    ]);
    for (const [position, bucket] of input.buckets.entries()) {
      await client.query(
        `insert into portfolio.buckets (id, user_id, name, target_percent, color, position)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          bucket.id,
          userId,
          bucket.name,
          bucket.targetPercent,
          bucket.color,
          position,
        ],
      );
    }
    for (const [position, rule] of input.rules.entries()) {
      const previous = prices.get(`${rule.market}:${rule.symbol}`);
      await client.query(
        `insert into portfolio.rules
         (id, user_id, bucket_id, market, symbol, exchange_code, name, manual_price, quoted_price, quote_checked_at, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          rule.id,
          userId,
          rule.bucketId,
          rule.market,
          rule.symbol,
          rule.exchange,
          rule.name,
          rule.manualPrice,
          previous?.quoted_price ?? null,
          previous?.quote_checked_at ?? null,
          position,
        ],
      );
    }
    await client.query(
      `update portfolio.holdings h set bucket_id = r.bucket_id
       from portfolio.rules r
       where h.user_id = $1 and r.user_id = $1 and h.market = r.market and h.symbol = r.symbol`,
      [userId],
    );
    for (const assignment of input.assignments.filter(
      (item) => item.source === "manual",
    )) {
      const result = await client.query(
        `update portfolio.holdings set bucket_id = $3, assignment_source = 'manual', updated_at = now()
         where user_id = $1 and id = $2`,
        [userId, assignment.holdingId, assignment.bucketId],
      );
      if (result.rowCount !== 1)
        throw new Error("보유 종목 배정 정보를 확인해 주세요");
    }
    for (const asset of input.manualAssets) {
      await client.query(
        `insert into portfolio.manual_assets (id, user_id, bucket_id, name, value_krw)
         values ($1,$2,$3,$4,$5)`,
        [asset.id, userId, asset.bucketId, asset.name, asset.valueKrw],
      );
    }
    await recordSnapshot(userId, client);
    const saved = await listPortfolio(userId, client);
    await client.query("commit");
    return saved;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function addCashFlow(userId: string, flow: CashFlow) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into portfolio.cash_flows (id, user_id, flow_date, amount_krw, note) values ($1,$2,$3,$4,$5)`,
      [flow.id, userId, flow.date, flow.amountKrw, flow.note],
    );
    const result = await listPortfolio(userId, client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteCashFlow(userId: string, flowId: string) {
  const result = await db().query(
    `delete from portfolio.cash_flows where user_id = $1 and id = $2`,
    [userId, flowId],
  );
  return result.rowCount === 1;
}

export async function listRules(userId: string) {
  const result = await db().query<{
    id: string;
    market: "KR" | "US";
    symbol: string;
    exchange_code: string | null;
  }>(
    `select id, market, symbol, exchange_code from portfolio.rules where user_id = $1`,
    [userId],
  );
  return result.rows;
}

export async function setRuleQuote(
  userId: string,
  market: "KR" | "US",
  symbol: string,
  price: number,
  checkedAt: string,
) {
  await db().query(
    `update portfolio.rules set quoted_price = $4, quote_checked_at = $5
     where user_id = $1 and market = $2 and symbol = $3`,
    [userId, market, symbol, price, checkedAt],
  );
}

export async function recordSnapshot(userId: string, client: Client = db()) {
  const plan = await client.query<{ usd_krw: string }>(
    `select usd_krw from portfolio.plans where user_id = $1`,
    [userId],
  );
  if (!plan.rows[0]) return;
  const fx = Number(plan.rows[0].usd_krw);
  const buckets = await client.query<{
    id: string;
    name: string;
    target_percent: string;
  }>(
    `select id, name, target_percent from portfolio.buckets where user_id = $1`,
    [userId],
  );
  const holdings = await client.query<{
    bucket_id: string | null;
    market: "KR" | "US";
    quantity: string;
    price: string | null;
  }>(
    `select bucket_id, market, quantity, coalesce(current_price, captured_price) as price
       from portfolio.holdings where user_id = $1`,
    [userId],
  );
  const manualAssets = await client.query<{
    bucket_id: string | null;
    value_krw: string;
  }>(
    `select bucket_id, value_krw from portfolio.manual_assets where user_id = $1`,
    [userId],
  );
  const values = new Map<string, number>(
    buckets.rows.map((row) => [row.id, 0]),
  );
  values.set("__UNASSIGNED__", 0);
  function add(bucketId: string | null, value: number) {
    const key = bucketId && values.has(bucketId) ? bucketId : "__UNASSIGNED__";
    values.set(key, (values.get(key) ?? 0) + value);
  }
  for (const row of holdings.rows) {
    add(
      row.bucket_id,
      Number(row.quantity) *
        Number(row.price ?? 0) *
        (row.market === "US" ? fx : 1),
    );
  }
  for (const row of manualAssets.rows)
    add(row.bucket_id, Number(row.value_krw));
  values.set(
    "__TOTAL__",
    [...values.values()].reduce((sum, value) => sum + value, 0),
  );
  await client.query(
    `delete from portfolio.snapshots where user_id = $1 and snapshot_date = (now() at time zone 'Asia/Seoul')::date`,
    [userId],
  );
  const names = new Map(buckets.rows.map((row) => [row.id, row.name]));
  const targets = new Map(
    buckets.rows.map((row) => [row.id, Number(row.target_percent)]),
  );
  for (const [key, value] of values) {
    await client.query(
      `insert into portfolio.snapshots
       (user_id, snapshot_date, bucket_key, bucket_name, value_krw, target_percent)
       values ($1,(now() at time zone 'Asia/Seoul')::date,$2,$3,$4,$5)
       on conflict (user_id, snapshot_date, bucket_key) do update set
         bucket_name = excluded.bucket_name, value_krw = excluded.value_krw,
         target_percent = excluded.target_percent, captured_at = now()`,
      [
        userId,
        key,
        key === "__TOTAL__"
          ? "전체"
          : key === "__UNASSIGNED__"
            ? "미분류"
            : names.get(key),
        Math.round(value * 100) / 100,
        targets.get(key) ?? null,
      ],
    );
  }
}
