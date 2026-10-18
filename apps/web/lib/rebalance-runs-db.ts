import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "./db";
import { listHoldings } from "./holdings-db";
import { listPortfolio, recordSnapshot } from "./portfolio-db";
import {
  appendRunFill,
  readRunFills,
  runFromRow,
  type RunRow,
} from "./rebalance-progress-db";
import { calculateTradeCash } from "../app/position-trade";
import { nextStockBasis, nextCashFx } from "../app/fx-gains";
import { holdingBucketId } from "../app/portfolio-model";
import {
  freezeRunSnapshot,
  replaceRunItem,
  type RunReplacement,
  captureRunOutcome,
  runItemProgress,
  calculateRunPosition,
  RunError,
  type RunConfig,
  type RunExecution,
} from "../app/rebalance-runs";

async function lockOwner(client: PoolClient, userId: string) {
  const r = await client.query(
    `select usd_krw from portfolio.plans where user_id=$1 for update`,
    [userId],
  );
  if (!r.rows.length)
    throw new RunError("포트폴리오를 먼저 만들어 주세요.", 404);
}
async function outcome(client: PoolClient, userId: string, row: RunRow) {
  const [p, h] = await Promise.all([
    listPortfolio(userId, client),
    listHoldings(userId, client),
  ]);
  if (!p) throw new RunError("포트폴리오를 찾지 못했습니다.", 404);
  return captureRunOutcome(row.snapshot, p, h);
}
export async function listRebalanceRuns(userId: string, offset = 0) {
  const [active, history] = await Promise.all([
    db().query<RunRow>(
      `select * from portfolio.rebalance_runs where user_id=$1 and status='active'`,
      [userId],
    ),
    db().query<RunRow>(
      `select * from portfolio.rebalance_runs where user_id=$1 and status<>'active' order by created_at desc,id desc limit 21 offset $2`,
      [userId, offset],
    ),
  ]);
  return {
    active: active.rows[0]
      ? await runFromRow(db(), userId, active.rows[0])
      : null,
    history: await Promise.all(
      history.rows.slice(0, 20).map((row) => runFromRow(db(), userId, row)),
    ),
    nextOffset: history.rows.length > 20 ? offset + 20 : null,
  };
}
export async function startRebalanceRun(
  userId: string,
  id: string,
  config: RunConfig,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await lockOwner(client, userId);
    const existing = await client.query<RunRow>(
      `select * from portfolio.rebalance_runs where user_id=$1 and id=$2`,
      [userId, id],
    );
    if (existing.rows[0]) {
      const run = await runFromRow(client, userId, existing.rows[0]);
      await client.query("commit");
      return run;
    }
    const active = await client.query(
      `select id from portfolio.rebalance_runs where user_id=$1 and status='active'`,
      [userId],
    );
    if (active.rows.length)
      throw new RunError(
        "이미 진행 중인 계획이 있습니다. 완료하거나 중단한 뒤 새 계획을 시작하세요.",
        409,
      );
    const [plan, holdings] = await Promise.all([
      listPortfolio(userId, client),
      listHoldings(userId, client),
    ]);
    if (!plan) throw new RunError("포트폴리오를 찾지 못했습니다.", 404);
    const snapshot = freezeRunSnapshot(plan, holdings, config, randomUUID);
    const result = await client.query<RunRow>(
      `insert into portfolio.rebalance_runs(id,user_id,snapshot) values($1,$2,$3) returning *`,
      [id, userId, JSON.stringify(snapshot)],
    );
    const run = await runFromRow(client, userId, result.rows[0]);
    await client.query("commit");
    return run;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
export async function cancelRebalanceRun(
  userId: string,
  id: string,
  revision: number,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await lockOwner(client, userId);
    const result = await client.query<RunRow>(
      `select * from portfolio.rebalance_runs where user_id=$1 and id=$2 for update`,
      [userId, id],
    );
    const row = result.rows[0];
    if (!row) throw new RunError("계획을 찾지 못했습니다.", 404);
    if (row.status !== "active" || row.revision !== revision)
      throw new RunError("계획이 변경되었습니다. 새로고침 후 확인하세요.", 409);
    const actual = await outcome(client, userId, row);
    await client.query(
      `update portfolio.rebalance_runs set status='cancelled',ended_at=now(),revision=revision+1,outcome=$3 where user_id=$1 and id=$2`,
      [userId, id, JSON.stringify(actual)],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
export async function executeRebalanceItem(
  userId: string,
  input: RunExecution,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await lockOwner(client, userId);
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const duplicate = await client.query<{
      payload_hash: string;
      run_id: string;
    }>(
      `select payload_hash,run_id from portfolio.rebalance_fills where user_id=$1 and id=$2`,
      [userId, input.requestId],
    );
    if (duplicate.rows[0]) {
      if (
        duplicate.rows[0].payload_hash !== hash ||
        duplicate.rows[0].run_id !== input.runId
      )
        throw new RunError("이미 사용한 거래 요청입니다.", 409);
      const result = {
        holdings: await listHoldings(userId, client),
        portfolio: await listPortfolio(userId, client),
        alreadyRecorded: true,
      };
      await client.query("commit");
      return result;
    }
    const result = await client.query<RunRow>(
      `select * from portfolio.rebalance_runs where user_id=$1 and id=$2 for update`,
      [userId, input.runId],
    );
    const row = result.rows[0];
    if (!row) throw new RunError("계획을 찾지 못했습니다.", 404);
    if (row.status !== "active" || row.revision !== input.revision)
      throw new RunError(
        "다른 거래가 반영되었거나 종료된 계획입니다. 새로고침해서 남은 수량을 확인하세요.",
        409,
      );
    const item = row.snapshot.items.find((i) => i.id === input.itemId);
    if (!item) throw new RunError("계획의 거래 항목을 찾지 못했습니다.", 404);
    const fills = await readRunFills(client, userId, row.id);
    if (input.quantity > runItemProgress(item, fills).remaining + 1e-10)
      throw new RunError(
        "남은 계획 수량보다 많이 입력했습니다. 실제 추가 거래는 자산 수정에서 입력하세요.",
      );
    const plan = await listPortfolio(userId, client);
    if (!plan) throw new RunError("포트폴리오를 찾지 못했습니다.", 404);
    const trade = {
      side: item.side,
      quantity: input.quantity,
      price: input.price,
      fee: input.fee,
    };
    let holdingId: string | null = null;
    if (item.kind === "stock") {
      const accountId = item.accountId ?? input.accountId;
      if (!accountId) throw new RunError("매수한 계좌를 선택해 주세요.");
      const accounts = await client.query<{
        id: string;
        broker: string;
        name: string;
      }>(
        `select id,broker,name from portfolio.accounts where user_id=$1 and id=$2`,
        [userId, accountId],
      );
      const account = accounts.rows[0];
      if (!account) throw new RunError("계좌를 찾지 못했습니다.", 404);
      let holdings = await listHoldings(userId, client);
      const candidate = item.holdingId
        ? holdings.find((h) => h.id === item.holdingId)
        : holdings.find(
            (h) =>
              h.accountId === accountId &&
              h.market === item.market &&
              h.symbol === item.symbol,
          );
      if (item.holdingId && !candidate)
        throw new RunError(
          "계획의 보유 종목이 삭제되었습니다. 현재 잔고와 계획을 확인하세요.",
          409,
        );
      if (candidate) {
        await client.query(
          `select id from portfolio.holdings where user_id=$1 and id=$2 for update`,
          [userId, candidate.id],
        );
        holdings = await listHoldings(userId, client);
      }
      const held = candidate
        ? holdings.find((h) => h.id === candidate.id)
        : undefined;
      if (
        (held?.quantity ?? 0) !== input.expectedQuantity ||
        (held && held.revision !== input.expectedRevision)
      )
        throw new RunError(
          "보유 수량이 변경되었습니다. 새로고침 후 다시 입력하세요.",
          409,
        );
      if (
        held &&
        (held.accountId !== accountId ||
          held.market !== item.market ||
          held.symbol !== item.symbol)
      )
        throw new RunError(
          "계획의 계좌나 종목 정보가 변경되었습니다. 계획을 확인하세요.",
          409,
        );
      if (held && holdingBucketId(plan, held) !== item.bucketId)
        throw new RunError(
          "종목의 포트 배정이 변경되었습니다. 계획을 확인하세요.",
          409,
        );
      if (!plan.buckets.some((b) => b.id === item.bucketId))
        throw new RunError("계획의 포트가 삭제되었습니다.", 409);
      if (item.side === "sell" && !held)
        throw new RunError("매도할 보유 종목이 없습니다.", 409);
      const next = calculateRunPosition(
        item,
        {
          quantity: held?.quantity ?? 0,
          averageCost: held?.averageCost ?? null,
        },
        trade,
      );
      const basis =
        item.market === "US"
          ? nextStockBasis(
              held?.quantity ?? 0,
              held?.averageCostKrw ?? (held ? null : 0),
              item.side,
              input.quantity,
              input.price,
              input.fee,
              input.fxRate,
            )
          : null;
      holdingId = held?.id ?? randomUUID();
      if (held) {
        if (next.quantity === 0)
          await client.query(
            `delete from portfolio.holdings where user_id=$1 and id=$2`,
            [userId, held.id],
          );
        else
          await client.query(
            `update portfolio.holdings set quantity=$3,average_cost=$4,average_cost_krw=$5,updated_at=now() where user_id=$1 and id=$2`,
            [userId, held.id, next.quantity, next.averageCost, basis],
          );
      } else {
        const rule = plan.rules.find(
          (r) => r.market === item.market && r.symbol === item.symbol,
        );
        await client.query(
          `insert into portfolio.holdings(id,user_id,broker,account_label,market,name,symbol,exchange_code,bucket_id,assignment_source,quantity,captured_price,average_cost,captured_at,account_id,average_cost_krw,current_price,quote_label,quote_checked_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,now(),$13,$14,$15,$16,$17)`,
          [
            holdingId,
            userId,
            account.broker,
            account.name,
            item.market,
            item.name,
            item.symbol,
            item.exchange,
            item.bucketId,
            next.quantity,
            input.price,
            next.averageCost,
            accountId,
            basis,
            rule?.quotedPrice ?? null,
            rule?.quotedPrice ? "KIS 후보 조회 시세" : null,
            rule?.quoteCheckedAt ?? null,
          ],
        );
      }
    } else {
      const crypto = await client.query<{
        quantity: string;
        average_cost_krw: string | null;
        bucket_id: string | null;
        market_code: string;
      }>(
        `select quantity,average_cost_krw,bucket_id,market_code from portfolio.crypto_assets where user_id=$1 and id=$2 for update`,
        [userId, item.assetId],
      );
      const held = crypto.rows[0];
      if (!held) throw new RunError("가상자산을 찾지 못했습니다.", 404);
      if (held.bucket_id !== item.bucketId || held.market_code !== item.symbol)
        throw new RunError(
          "가상자산의 포트 배정이 변경되었습니다. 계획을 확인하세요.",
          409,
        );
      if (Number(held.quantity) !== input.expectedQuantity)
        throw new RunError(
          "가상자산 수량이 변경되었습니다. 새로고침 후 다시 입력하세요.",
          409,
        );
      const next = calculateRunPosition(
        item,
        {
          quantity: Number(held.quantity),
          averageCost:
            held.average_cost_krw === null
              ? null
              : Number(held.average_cost_krw),
        },
        trade,
      );
      await client.query(
        `update portfolio.crypto_assets set quantity=$3,average_cost_krw=$4,last_trade_at=now(),updated_at=now() where user_id=$1 and id=$2`,
        [userId, item.assetId, next.quantity, next.averageCost],
      );
    }
    if (input.cash) {
      const cashResult = await client.query<{
        value_krw: string;
        value_usd: string | null;
        average_fx_rate: string | null;
      }>(
        `select value_krw,value_usd,average_fx_rate from portfolio.manual_assets where user_id=$1 and id=$2 for update`,
        [userId, input.cash.assetId],
      );
      const cash = cashResult.rows[0];
      if (!cash) throw new RunError("현금 자산을 찾지 못했습니다.", 404);
      if ((item.currency === "USD") !== (cash.value_usd !== null))
        throw new RunError("거래 통화와 같은 현금 자산을 선택하세요.");
      const balance = Number(cash.value_usd ?? cash.value_krw);
      if (balance !== input.cash.expectedBalance)
        throw new RunError(
          "현금 잔고가 변경되었습니다. 새로고침 후 다시 입력하세요.",
          409,
        );
      const change = calculateTradeCash(
        balance,
        trade,
        item.currency === "USD" ? "US" : "KR",
      );
      await client.query(
        `update portfolio.manual_assets set value_krw=$3,value_usd=$4,average_fx_rate=$5,updated_at=now() where user_id=$1 and id=$2`,
        [
          userId,
          input.cash.assetId,
          item.currency === "USD"
            ? change.balance * plan.usdKrw
            : change.balance,
          item.currency === "USD" ? change.balance : null,
          item.currency === "USD"
            ? nextCashFx(
                balance,
                cash.average_fx_rate === null
                  ? null
                  : Number(cash.average_fx_rate),
                change.delta,
                input.fxRate,
              )
            : null,
        ],
      );
      await client.query(
        `update portfolio.plans set cash_revision=cash_revision+1 where user_id=$1`,
        [userId],
      );
    }
    await recordSnapshot(userId, client);
    await appendRunFill(
      client,
      userId,
      row,
      {
        id: input.requestId,
        itemId: item.id,
        holdingId,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        currency: item.currency,
        fxRate: input.fxRate,
        source: "plan",
      },
      hash,
      () => outcome(client, userId, row),
    );
    const final = {
      holdings: await listHoldings(userId, client),
      portfolio: await listPortfolio(userId, client),
      alreadyRecorded: false,
    };
    await client.query("commit");
    return final;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function replaceRebalanceItem(
  userId: string,
  input: RunReplacement,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    await lockOwner(client, userId);
    const result = await client.query<RunRow>(
      `select * from portfolio.rebalance_runs where user_id=$1 and id=$2 for update`,
      [userId, input.runId],
    );
    const row = result.rows[0];
    if (!row) throw new RunError("계획을 찾지 못했습니다.", 404);
    const prior = row.snapshot.changes?.find((c) => c.id === input.changeId);
    if (prior) {
      if (
        prior.from.id !== input.itemId ||
        prior.selection !== input.selection ||
        prior.to.quantity !== input.expectedQuantity ||
        prior.to.unitPrice !== input.expectedPrice
      )
        throw new RunError("이미 사용한 변경 요청입니다.", 409);
      const run = await runFromRow(client, userId, row);
      await client.query("commit");
      return run;
    }
    if (row.status !== "active" || row.revision !== input.revision)
      throw new RunError(
        "계획이 변경되었습니다. 새로고침 후 다시 선택하세요.",
        409,
      );
    const run = await runFromRow(client, userId, row);
    const plan = await listPortfolio(userId, client);
    if (!plan) throw new RunError("포트폴리오를 찾지 못했습니다.", 404);
    const holdings = await listHoldings(userId, client);
    const snapshot = replaceRunItem(
      run,
      input,
      plan,
      holdings,
      randomUUID(),
      new Date().toISOString(),
    );
    const updated = await client.query<RunRow>(
      `update portfolio.rebalance_runs set snapshot=$3,revision=revision+1 where user_id=$1 and id=$2 returning *`,
      [userId, input.runId, JSON.stringify(snapshot)],
    );
    const saved = await runFromRow(client, userId, updated.rows[0]);
    await client.query("commit");
    return saved;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
