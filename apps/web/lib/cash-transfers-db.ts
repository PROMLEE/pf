import { db } from "./db";
import { listPortfolio, recordSnapshot } from "./portfolio-db";
import {
  CashTransferError,
  transferBalances,
  transferredFx,
  type CashTransferInput,
} from "../app/cash-transfer";
export async function listCashTransfers(userId: string) {
  return (
    await db().query(
      `select id,source_name,destination_name,currency,amount::text,note,created_at from portfolio.cash_transfers where user_id=$1 order by created_at desc limit 30`,
      [userId],
    )
  ).rows;
}
export async function applyCashTransfer(
  userId: string,
  input: CashTransferInput,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const plan = (
      await client.query(
        `select usd_krw,cash_revision from portfolio.plans where user_id=$1 for update`,
        [userId],
      )
    ).rows[0];
    if (!plan)
      throw new CashTransferError("포트폴리오를 찾지 못했습니다.", 404);
    const previous = (
      await client.query(
        `select source_id,destination_id,amount,note from portfolio.cash_transfers where user_id=$1 and id=$2`,
        [userId, input.id],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.source_id !== input.sourceId ||
        previous.destination_id !== input.destinationId ||
        Number(previous.amount) !== input.amount ||
        previous.note !== input.note.trim()
      )
        throw new CashTransferError(
          "이미 다른 내용으로 처리한 요청입니다.",
          409,
        );
      const portfolio = await listPortfolio(userId, client);
      await client.query("commit");
      return { portfolio, replayed: true };
    }
    if (Number(plan.cash_revision) !== input.expectedRevision)
      throw new CashTransferError(
        "잔액 정보가 변경되었습니다. 최신 잔액을 불러온 뒤 다시 확인해 주세요.",
        409,
      );
    const rows = (
      await client.query(
        `select m.*,a.broker,a.name as account_name from portfolio.manual_assets m left join portfolio.accounts a on a.id=m.account_id and a.user_id=m.user_id where m.user_id=$1 and m.id=any($2::uuid[]) order by m.id for update of m`,
        [userId, [input.sourceId, input.destinationId]],
      )
    ).rows;
    const source = rows.find((r) => r.id === input.sourceId),
      destination = rows.find((r) => r.id === input.destinationId);
    if (!source || !destination)
      throw new CashTransferError("선택한 현금 자산을 찾지 못했습니다.", 404);
    if ((source.value_usd === null) !== (destination.value_usd === null))
      throw new CashTransferError(
        "동일한 통화끼리만 이체할 수 있습니다. 원화와 달러 간 환전은 지원하지 않습니다.",
      );
    const currency = source.value_usd === null ? "KRW" : "USD";
    const balances = transferBalances(
      source.value_usd ?? source.value_krw,
      destination.value_usd ?? destination.value_krw,
      input.amount,
      currency,
    );
    const average =
      currency === "USD"
        ? transferredFx(
            source.average_fx_rate === null
              ? null
              : Number(source.average_fx_rate),
            destination.average_fx_rate === null
              ? null
              : Number(destination.average_fx_rate),
            Number(destination.value_usd),
            input.amount,
          )
        : null;
    for (const [asset, balance, rate] of [
      [
        source,
        balances.source,
        currency === "USD" ? source.average_fx_rate : null,
      ],
      [destination, balances.destination, average],
    ] as const) {
      await client.query(
        `update portfolio.manual_assets set value_krw=$3::numeric * $4::numeric,value_usd=$5,average_fx_rate=$6,updated_at=now() where user_id=$1 and id=$2`,
        [
          userId,
          asset.id,
          balance,
          currency === "USD" ? plan.usd_krw : 1,
          currency === "USD" ? balance : null,
          rate,
        ],
      );
    }
    const label = (asset: typeof source) =>
      [asset.broker, asset.account_name, asset.name]
        .filter(Boolean)
        .join(" · ");
    await client.query(
      `insert into portfolio.cash_transfers(id,user_id,source_id,destination_id,source_name,destination_name,currency,amount,note) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.id,
        userId,
        input.sourceId,
        input.destinationId,
        label(source),
        label(destination),
        currency,
        input.amount.toFixed(currency === "KRW" ? 0 : 2),
        input.note.trim(),
      ],
    );
    await client.query(
      `update portfolio.plans set cash_revision=cash_revision+1 where user_id=$1`,
      [userId],
    );
    await recordSnapshot(userId, client);
    const portfolio = await listPortfolio(userId, client);
    await client.query("commit");
    return { portfolio, replayed: false };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
