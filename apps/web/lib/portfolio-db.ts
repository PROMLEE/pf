import type { PoolClient } from "pg";
import type {
  Assignment,
  Bucket,
  CashFlow,
  CryptoAsset,
  ManualAsset,
  Portfolio,
  Rule,
  Snapshot,
} from "../app/portfolio-model";
import { positionSignature } from "../app/portfolio-model";
import { db } from "./db";

type Client = Pick<PoolClient, "query">;
type PlanRow = {
  title: string;
  usd_krw: string;
  usd_krw_updated_at: Date;
  usd_krw_mode: "auto" | "manual";
  usd_krw_rate_date: string | null;
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
  value_usd: string | null;
};
type CryptoRow = {
  id: string;
  bucket_id: string | null;
  market_code: string;
  name: string;
  quantity: string;
  average_cost_krw: string | null;
  quoted_price_krw: string | null;
  quote_checked_at: Date | null;
  last_trade_at: Date | null;
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
  position_signature: string | null;
};

export async function listPortfolio(
  userId: string,
  client: Client = db(),
): Promise<Portfolio | null> {
  const plan = await client.query<PlanRow>(
    `select title, usd_krw, usd_krw_updated_at, usd_krw_mode, usd_krw_rate_date::text as usd_krw_rate_date, tolerance_percent from portfolio.plans where user_id = $1`,
    [userId],
  );
  if (!plan.rows[0]) return null;
  const [
    buckets,
    rules,
    manualAssets,
    cryptoAssets,
    assignments,
    snapshots,
    cashFlows,
  ] = await Promise.all([
    client.query<BucketRow>(
      `select id, name, target_percent, color from portfolio.buckets where user_id = $1 order by position, name`,
      [userId],
    ),
    client.query<RuleRow>(
      `select id, bucket_id, market, symbol, exchange_code, name, manual_price, quoted_price, quote_checked_at
       from portfolio.rules where user_id = $1 order by position, symbol`,
      [userId],
    ),
    client.query<ManualRow>(
      `select id, bucket_id, name, value_krw, value_usd from portfolio.manual_assets where user_id = $1 order by name`,
      [userId],
    ),
    client.query<CryptoRow>(
      `select id, bucket_id, market_code, name, quantity, average_cost_krw, quoted_price_krw, quote_checked_at, last_trade_at
       from portfolio.crypto_assets where user_id = $1 order by name`,
      [userId],
    ),
    client.query<AssignmentRow>(
      `select id, bucket_id, assignment_source from portfolio.holdings where user_id = $1`,
      [userId],
    ),
    client.query<SnapshotRow>(
      `select snapshot_date::text, bucket_key, bucket_name, value_krw, target_percent, position_signature
       from portfolio.snapshots where user_id = $1 order by snapshot_date, bucket_key`,
      [userId],
    ),
    client.query<CashFlowRow>(
      `select id, flow_date::text, amount_krw, note from portfolio.cash_flows where user_id = $1 order by flow_date desc, created_at desc`,
      [userId],
    ),
  ]);
  return {
    title: plan.rows[0].title,
    usdKrw: Number(plan.rows[0].usd_krw),
    usdKrwUpdatedAt: plan.rows[0].usd_krw_updated_at.toISOString(),
    usdKrwMode: plan.rows[0].usd_krw_mode,
    usdKrwRateDate: plan.rows[0].usd_krw_rate_date,
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
        valueUsd: row.value_usd === null ? null : Number(row.value_usd),
      }),
    ),
    cryptoAssets: cryptoAssets.rows.map(
      (row): CryptoAsset => ({
        id: row.id,
        bucketId: row.bucket_id,
        marketCode: row.market_code,
        name: row.name,
        quantity: Number(row.quantity),
        averageCostKrw:
          row.average_cost_krw === null ? null : Number(row.average_cost_krw),
        quotedPriceKrw:
          row.quoted_price_krw === null ? null : Number(row.quoted_price_krw),
        quoteCheckedAt: row.quote_checked_at?.toISOString() ?? null,
        lastTradeAt: row.last_trade_at?.toISOString() ?? null,
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
        positionSignature: row.position_signature,
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
      `insert into portfolio.plans (user_id, title, usd_krw, usd_krw_mode, usd_krw_rate_date, tolerance_percent)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id) do update set title = excluded.title, usd_krw = excluded.usd_krw,
         usd_krw_updated_at = case when portfolio.plans.usd_krw is distinct from excluded.usd_krw or portfolio.plans.usd_krw_mode is distinct from excluded.usd_krw_mode then now() else portfolio.plans.usd_krw_updated_at end,
         usd_krw_mode = excluded.usd_krw_mode, usd_krw_rate_date = excluded.usd_krw_rate_date,
         tolerance_percent = excluded.tolerance_percent, updated_at = now()`,
      [
        userId,
        input.title,
        input.usdKrw,
        input.usdKrwMode,
        input.usdKrwRateDate,
        input.tolerancePercent,
      ],
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
    const previousCrypto = await client.query<{
      market_code: string;
      quoted_price_krw: string | null;
      quote_checked_at: Date | null;
      last_trade_at: Date | null;
    }>(
      `select market_code, quoted_price_krw, quote_checked_at, last_trade_at
       from portfolio.crypto_assets where user_id = $1`,
      [userId],
    );
    const cryptoPrices = new Map(
      previousCrypto.rows.map((row) => [row.market_code, row]),
    );
    await client.query(
      `delete from portfolio.manual_assets where user_id = $1`,
      [userId],
    );
    await client.query(
      `delete from portfolio.crypto_assets where user_id = $1`,
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
        `insert into portfolio.manual_assets (id, user_id, bucket_id, name, value_krw, value_usd)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          asset.id,
          userId,
          asset.bucketId,
          asset.name,
          asset.valueUsd === null
            ? asset.valueKrw
            : asset.valueUsd * input.usdKrw,
          asset.valueUsd,
        ],
      );
    }
    for (const asset of input.cryptoAssets) {
      const previous = cryptoPrices.get(asset.marketCode);
      await client.query(
        `insert into portfolio.crypto_assets
         (id, user_id, bucket_id, market_code, name, quantity, average_cost_krw, quoted_price_krw, quote_checked_at, last_trade_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          asset.id,
          userId,
          asset.bucketId,
          asset.marketCode,
          asset.name,
          asset.quantity,
          asset.averageCostKrw,
          previous?.quoted_price_krw ?? null,
          previous?.quote_checked_at ?? null,
          previous?.last_trade_at ?? null,
        ],
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

export async function updateAutomaticFx(
  userId: string,
  rate: number,
  rateDate: string,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const updated = await client.query(
      `update portfolio.plans
       set usd_krw = $2, usd_krw_rate_date = $3,
           usd_krw_updated_at = now(), updated_at = now()
       where user_id = $1 and usd_krw_mode = 'auto'
         and (usd_krw_rate_date is null or usd_krw_rate_date <= $3::date)
         and (usd_krw is distinct from $2::numeric or usd_krw_rate_date is distinct from $3::date)`,
      [userId, rate, rateDate],
    );
    if (updated.rowCount) await recordSnapshot(userId, client);
    await client.query("commit");
    return Boolean(updated.rowCount);
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

export async function listCryptoAssets(userId: string) {
  const result = await db().query<{ market_code: string }>(
    `select market_code from portfolio.crypto_assets where user_id = $1 order by market_code`,
    [userId],
  );
  return result.rows.map((row) => row.market_code);
}

export async function setCryptoQuote(
  userId: string,
  marketCode: string,
  priceKrw: number,
  checkedAt: string,
  lastTradeAt: string | null,
) {
  await db().query(
    `update portfolio.crypto_assets
     set quoted_price_krw = $3, quote_checked_at = $4, last_trade_at = $5, updated_at = now()
     where user_id = $1 and market_code = $2`,
    [userId, marketCode, priceKrw, checkedAt, lastTradeAt],
  );
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
  const [plan, buckets, holdings, manualAssets, cryptoAssets] =
    await Promise.all([
      client.query<{ usd_krw: string }>(
        `select usd_krw from portfolio.plans where user_id = $1`,
        [userId],
      ),
      client.query<{
        id: string;
        name: string;
        target_percent: string;
      }>(
        `select id, name, target_percent from portfolio.buckets where user_id = $1`,
        [userId],
      ),
      client.query<{
        id: string;
        bucket_id: string | null;
        market: "KR" | "US";
        quantity: string;
        average_cost: string | null;
        captured_price: string | null;
        price: string | null;
      }>(
        `select id::text, bucket_id, market, quantity, average_cost, captured_price,
                coalesce(current_price, captured_price) as price
       from portfolio.holdings where user_id = $1`,
        [userId],
      ),
      client.query<{
        id: string;
        bucket_id: string | null;
        value_krw: string;
        value_usd: string | null;
      }>(
        `select id::text, bucket_id, value_krw, value_usd from portfolio.manual_assets where user_id = $1`,
        [userId],
      ),
      client.query<{
        id: string;
        bucket_id: string | null;
        quantity: string;
        average_cost_krw: string | null;
        quoted_price_krw: string | null;
      }>(
        `select id::text, bucket_id, quantity, average_cost_krw, quoted_price_krw
         from portfolio.crypto_assets where user_id = $1`,
        [userId],
      ),
    ]);
  if (!plan.rows[0]) return;
  const signature = positionSignature(
    holdings.rows.map((row) => ({
      id: row.id,
      market: row.market,
      quantity: Number(row.quantity),
      averageCost: row.average_cost === null ? null : Number(row.average_cost),
      capturedPrice:
        row.captured_price === null ? null : Number(row.captured_price),
    })),
    manualAssets.rows.map((row) => ({
      id: row.id,
      valueKrw: Number(row.value_krw),
      valueUsd: row.value_usd === null ? null : Number(row.value_usd),
    })),
    cryptoAssets.rows.map((row) => ({
      id: row.id,
      quantity: Number(row.quantity),
      averageCostKrw:
        row.average_cost_krw === null ? null : Number(row.average_cost_krw),
    })),
  );
  const fx = Number(plan.rows[0].usd_krw);
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
    add(
      row.bucket_id,
      row.value_usd === null
        ? Number(row.value_krw)
        : Number(row.value_usd) * fx,
    );
  for (const row of cryptoAssets.rows)
    add(
      row.bucket_id,
      Number(row.quantity) * Number(row.quoted_price_krw ?? 0),
    );
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
  const entries = [...values];
  const placeholders = entries
    .map((_, index) => {
      const start = index * 5 + 2;
      return `($1,(now() at time zone 'Asia/Seoul')::date,$${start},$${start + 1},$${start + 2},$${start + 3},$${start + 4})`;
    })
    .join(",");
  const parameters = [
    userId,
    ...entries.flatMap(([key, value]) => [
      key,
      key === "__TOTAL__"
        ? "전체"
        : key === "__UNASSIGNED__"
          ? "미분류"
          : names.get(key),
      Math.round(value * 100) / 100,
      targets.get(key) ?? null,
      key === "__TOTAL__" ? signature : null,
    ]),
  ];
  await client.query(
    `insert into portfolio.snapshots
     (user_id, snapshot_date, bucket_key, bucket_name, value_krw, target_percent, position_signature)
     values ${placeholders}
     on conflict (user_id, snapshot_date, bucket_key) do update set
       bucket_name = excluded.bucket_name, value_krw = excluded.value_krw,
       target_percent = excluded.target_percent,
       position_signature = excluded.position_signature, captured_at = now()`,
    parameters,
  );
}
