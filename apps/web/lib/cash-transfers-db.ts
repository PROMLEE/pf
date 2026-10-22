import { assertMeritzEditable } from "./meritz-readonly";
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
      `select id,kind,source_name,destination_name,currency,amount::text,note,created_at from portfolio.cash_transfers where user_id=$1 order by created_at desc limit 30`,
      [userId],
    )
  ).rows;
}
export async function applyCashTransfer(
  userId: string,
  input: CashTransferInput,
) {
  const kind = input.kind ?? "transfer";
  const client = await db().connect();
  try {
    await client.query("begin");
    await assertMeritzEditable(client, userId, { cashIds: [input.sourceId, input.destinationId] });
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
        `select source_id,destination_id,amount,note,kind,fx_rate from portfolio.cash_transfers where user_id=$1 and id=$2`,
        [userId, input.id],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.kind !== kind ||
        (previous.fx_rate == null ? null : Number(previous.fx_rate)) !==
          (input.fxRate ?? null) ||
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
        [userId, [input.sourceId, input.destinationId].filter(Boolean)],
      )
    ).rows;
    const source = rows.find((r) => r.id === input.sourceId),
      destination = rows.find((r) => r.id === input.destinationId);
    if ((input.sourceId && !source) || (input.destinationId && !destination))
      throw new CashTransferError("선택한 현금 자산을 찾지 못했습니다.", 404);
    if (
      source &&
      destination &&
      (source.value_usd === null) !== (destination.value_usd === null)
    )
      throw new CashTransferError(
        "동일한 통화끼리만 이체할 수 있습니다. 원화와 달러 간 환전은 지원하지 않습니다.",
      );
    const primary = source ?? destination;
    const currency = primary.value_usd === null ? "KRW" : "USD";
    if (currency === "KRW" && input.fxRate != null)
      throw new CashTransferError(
        "매입 환율은 달러 입금에만 입력할 수 있습니다.",
      );
    const balances = transferBalances(
      source ? (source.value_usd ?? source.value_krw) : input.amount.toFixed(6),
      destination ? (destination.value_usd ?? destination.value_krw) : "0",
      input.amount,
      currency,
    );
    const sourceRate =
      source?.average_fx_rate == null ? null : Number(source.average_fx_rate);
    const average =
      currency === "USD" && destination
        ? transferredFx(
            kind === "deposit" ? (input.fxRate ?? null) : sourceRate,
            destination.average_fx_rate == null
              ? null
              : Number(destination.average_fx_rate),
            Number(destination.value_usd),
            input.amount,
          )
        : null;
    const updates: {
      asset: typeof primary;
      balance: string;
      rate: number | null;
    }[] = [];
    if (source)
      updates.push({
        asset: source,
        balance: balances.source,
        rate: currency === "USD" ? sourceRate : null,
      });
    if (destination)
      updates.push({
        asset: destination,
        balance: balances.destination,
        rate: average,
      });
    for (const { asset, balance, rate } of updates) {
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
    const label = (asset: typeof primary) =>
      [asset.broker, asset.account_name, asset.name]
        .filter(Boolean)
        .join(" · ");
    await client.query(
      `insert into portfolio.cash_transfers(id,user_id,source_id,destination_id,source_name,destination_name,currency,amount,note,kind,fx_rate) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.id,
        userId,
        input.sourceId,
        input.destinationId,
        source ? label(source) : "외부",
        destination ? label(destination) : "외부",
        currency,
        input.amount.toFixed(currency === "KRW" ? 0 : 2),
        input.note.trim(),
        kind,
        input.fxRate ?? null,
      ],
    );
    if (kind !== "transfer") {
      const amountKrw =
        Math.round(
          input.amount * (currency === "USD" ? Number(plan.usd_krw) : 1) * 100,
        ) / 100;
      if (!Number.isFinite(amountKrw) || amountKrw <= 0 || amountKrw > 1e15)
        throw new CashTransferError(
          "원화 환산 입출금 금액이 기록 범위를 초과합니다.",
        );
      await client.query(
        `insert into portfolio.cash_flows(id,user_id,flow_date,amount_krw,note,occurred_at) values($1,$2,(now() at time zone 'Asia/Seoul')::date,$3,$4,now())`,
        [
          input.id,
          userId,
          kind === "deposit" ? amountKrw : -amountKrw,
          (
            input.note.trim() ||
            `${kind === "deposit" ? "외부 입금" : "외부 출금"} · ${primary.name}`
          ).slice(0, 120),
        ],
      );
    }
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
