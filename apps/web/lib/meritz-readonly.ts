import type { PoolClient } from "pg";
import type { ManualAsset } from "../app/portfolio-model";
import { CashTransferError } from "../app/cash-transfer";
export const meritzReadOnlyMessage =
  "메리츠 연동 자산은 직접 수정할 수 없습니다. 동기화 버튼으로 잔고를 반영해 주세요.";
type Client = Pick<PoolClient, "query">;
async function binding(client: Client, userId: string) {
  return (
    await client.query<{
      account_id: string;
      krw_asset_id: string;
      usd_asset_id: string;
    }>(
      "select account_id,krw_asset_id,usd_asset_id from portfolio.meritz_sync where user_id=$1 for share",
      [userId],
    )
  ).rows[0];
}
export async function assertMeritzEditable(
  client: Client,
  userId: string,
  target: {
    holdingId?: string;
    accountId?: string;
    cashIds?: (string | null | undefined)[];
  },
) {
  const sync = await binding(client, userId);
  if (!sync) return;
  let locked =
    target.accountId === sync.account_id ||
    target.cashIds?.some(
      (id) => id === sync.krw_asset_id || id === sync.usd_asset_id,
    );
  if (!locked && target.holdingId)
    locked = !!(
      await client.query(
        "select id from portfolio.holdings where user_id=$1 and id=$2 and account_id=$3",
        [userId, target.holdingId, sync.account_id],
      )
    ).rows.length;
  if (!locked && target.cashIds?.some(Boolean))
    locked = !!(
      await client.query(
        "select id from portfolio.manual_assets where user_id=$1 and id=any($2::uuid[]) and account_id=$3",
        [userId, target.cashIds.filter(Boolean), sync.account_id],
      )
    ).rows.length;
  if (locked) throw new CashTransferError(meritzReadOnlyMessage, 409);
}
// Portfolio saves may still change allocation, but cannot edit/delete synchronized balances.
export async function assertMeritzCashUnchanged(
  client: Client,
  userId: string,
  assets: ManualAsset[],
) {
  const sync = await binding(client, userId);
  if (!sync) return;
  const saved = (
    await client.query<{
      id: string;
      name: string;
      account_id: string | null;
      value_krw: string;
      value_usd: string | null;
      average_fx_rate: string | null;
    }>(
      "select id,name,account_id,value_krw,value_usd,average_fx_rate from portfolio.manual_assets where user_id=$1 and (account_id=$2 or id=any($3::uuid[]))",
      [userId, sync.account_id, [sync.krw_asset_id, sync.usd_asset_id]],
    )
  ).rows;
  const ids = new Set(saved.map((row) => row.id));
  if (
    assets.some(
      (asset) => asset.accountId === sync.account_id && !ids.has(asset.id),
    )
  )
    throw new CashTransferError(meritzReadOnlyMessage, 409);
  for (const row of saved) {
    const next = assets.find((asset) => asset.id === row.id);
    if (
      !next ||
      next.name !== row.name ||
      (next.accountId ?? null) !== row.account_id ||
      next.valueUsd !==
        (row.value_usd === null ? null : Number(row.value_usd)) ||
      (row.value_usd === null && next.valueKrw !== Number(row.value_krw)) ||
      (next.averageFxRate ?? null) !==
        (row.average_fx_rate === null ? null : Number(row.average_fx_rate))
    )
      throw new CashTransferError(meritzReadOnlyMessage, 409);
  }
}
