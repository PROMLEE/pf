import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "./db";
import { meritzAvailable, fetchMeritzBalance } from "./meritz";
import {
  createMeritzPreview,
  applyMeritzPreview,
  MeritzImportError,
} from "./meritz-import";
import { listHoldings } from "./holdings-db";
import { listPortfolio } from "./portfolio-db";
export const meritzKeyHash = () =>
  createHash("sha256")
    .update(process.env.MERITZ_APP_KEY ?? "")
    .digest("hex");
export async function meritzSyncStatus(
  userId: string,
  client: Pick<PoolClient, "query"> = db(),
) {
  const row = (
    await client.query<{
      enabled: boolean;
      account_id: string;
      account_name: string;
      key_hash: string;
      last_success_at: Date | null;
      last_attempt_at: Date | null;
      last_error: string | null;
      last_change_count: number;
    }>(
      `select s.*,a.name as account_name from portfolio.meritz_sync s join portfolio.accounts a on a.user_id=s.user_id and a.id=s.account_id where s.user_id=$1`,
      [userId],
    )
  ).rows[0];
  return {
    available: meritzAvailable(userId),
    configured: !!row,
    enabled: !!row?.enabled,
    accountId: row?.account_id ?? null,
    accountName: row?.account_name ?? null,
    lastSuccessAt: row?.last_success_at?.toISOString() ?? null,
    lastAttemptAt: row?.last_attempt_at?.toISOString() ?? null,
    error:
      row?.key_hash && row.key_hash !== meritzKeyHash()
        ? "메리츠 키가 변경되었습니다. 계좌 연결을 다시 확인해 주세요."
        : (row?.last_error ?? null),
    count: row?.last_change_count ?? 0,
  };
}
export async function configureMeritzSync(
  userId: string,
  accountId: string,
  krwId: string,
  usdId: string,
) {
  if (!meritzAvailable(userId))
    throw new MeritzImportError(
      "이 계정에 연결된 메리츠 계좌가 없습니다.",
      403,
    );
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      "select user_id from portfolio.meritz_sync where user_id=$1 for update",
      [userId],
    );
    await client.query(
      "select id from portfolio.accounts where user_id=$1 and id=$2 for update",
      [userId, accountId],
    );
    const account = (
      await client.query(
        "select id from portfolio.accounts where user_id=$1 and id=$2 and broker like '%메리츠%'",
        [userId, accountId],
      )
    ).rows[0];
    const assets = (
      await client.query<{
        id: string;
        account_id: string | null;
        value_usd: string | null;
      }>(
        "select id,account_id,value_usd from portfolio.manual_assets where user_id=$1 and id=any($2::uuid[]) order by id for update",
        [userId, [krwId, usdId]],
      )
    ).rows;
    const krw = assets.find((a) => a.id === krwId),
      usd = assets.find((a) => a.id === usdId);
    if (
      !account ||
      krwId === usdId ||
      !krw ||
      !usd ||
      krw.value_usd !== null ||
      usd.value_usd === null ||
      assets.some((a) => a.account_id && a.account_id !== accountId)
    )
      throw new MeritzImportError(
        "동기화할 계좌와 원화·달러 현금 연결을 확인해 주세요.",
      );
    await client.query(
      "update portfolio.manual_assets set account_id=$3 where user_id=$1 and id=any($2::uuid[])",
      [userId, [krwId, usdId], accountId],
    );
    await client.query(
      `insert into portfolio.meritz_sync(user_id,account_id,krw_asset_id,usd_asset_id,key_hash,enabled) values($1,$2,$3,$4,$5,true) on conflict(user_id) do update set account_id=$2,krw_asset_id=$3,usd_asset_id=$4,key_hash=$5,enabled=true,last_attempt_at=null,last_error=null,updated_at=now()`,
      [userId, accountId, krwId, usdId, meritzKeyHash()],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  return meritzSyncStatus(userId);
}
export async function setMeritzSyncEnabled(userId: string, enabled: boolean) {
  if (!meritzAvailable(userId))
    throw new MeritzImportError("접근할 수 없습니다.", 403);
  const result = await db().query(
    "update portfolio.meritz_sync set enabled=$2,last_error=null,last_attempt_at=case when $2 then null else last_attempt_at end,updated_at=now() where user_id=$1 and key_hash=$3 returning user_id",
    [userId, enabled, meritzKeyHash()],
  );
  if (!result.rowCount)
    throw new MeritzImportError("계좌 연결을 먼저 확인해 주세요.");
  return meritzSyncStatus(userId);
}
export async function syncMeritzBalance(userId: string) {
  if (!meritzAvailable(userId))
    throw new MeritzImportError("접근할 수 없습니다.", 403);
  const client = await db().connect();
  const leaseId = randomUUID();
  let locked = false,
    inTransaction = false;
  try {
    const config = (
      await client.query<{
        enabled: boolean;
        account_id: string;
        krw_asset_id: string;
        usd_asset_id: string;
        key_hash: string;
        last_attempt_at: Date | null;
        last_error: string | null;
      }>("select * from portfolio.meritz_sync where user_id=$1", [userId])
    ).rows[0];
    if (!config?.enabled)
      return {
        state: "disabled",
        sync: await meritzSyncStatus(userId, client),
      };
    if (config.key_hash !== meritzKeyHash())
      return { state: "error", sync: await meritzSyncStatus(userId, client) };
    const cooldown = config.last_error ? 60000 : 25000;
    if (
      config.last_attempt_at &&
      Date.now() - config.last_attempt_at.getTime() < cooldown
    )
      return {
        state: "cached",
        sync: await meritzSyncStatus(userId, client),
        holdings: await listHoldings(userId, client),
        portfolio: await listPortfolio(userId, client),
      };
    const claim = await client.query(
      `update portfolio.meritz_sync set lease_id=$2,lease_until=clock_timestamp()+interval '90 seconds',last_attempt_at=clock_timestamp()
      where user_id=$1 and enabled and key_hash=$3 and account_id=$4 and krw_asset_id=$5 and usd_asset_id=$6
      and (lease_until is null or lease_until<clock_timestamp())
      and (last_attempt_at is null or last_attempt_at<clock_timestamp()-(case when last_error is null then interval '25 seconds' else interval '60 seconds' end)) returning user_id`,
      [
        userId,
        leaseId,
        config.key_hash,
        config.account_id,
        config.krw_asset_id,
        config.usd_asset_id,
      ],
    );
    locked = !!claim.rowCount;
    if (!locked)
      return { state: "busy", sync: await meritzSyncStatus(userId, client) };
    const remote = await fetchMeritzBalance();
    await client.query("begin");
    inTransaction = true;
    await client.query("set local idle_in_transaction_session_timeout='30s'");
    // A pause or configuration change during the fetch must take effect before any asset writes.
    const latest = (
      await client.query(
        "select enabled,account_id,krw_asset_id,usd_asset_id,key_hash,lease_id,lease_until>clock_timestamp() as lease_valid from portfolio.meritz_sync where user_id=$1 for update",
        [userId],
      )
    ).rows[0];
    if (
      !latest?.enabled ||
      latest.lease_id !== leaseId ||
      !latest.lease_valid ||
      ["account_id", "krw_asset_id", "usd_asset_id", "key_hash"].some(
        (k) => latest[k] !== config[k as keyof typeof config],
      )
    ) {
      await client.query("rollback");
      inTransaction = false;
      return {
        state: "disabled",
        sync: await meritzSyncStatus(userId, client),
      };
    }
    const preview = await createMeritzPreview(
      userId,
      {
        accountId: config.account_id,
        krwAssetId: config.krw_asset_id,
        usdAssetId: config.usd_asset_id,
      },
      { remote, client, authoritative: true },
    );
    if (preview.warnings.length)
      throw new MeritzImportError(
        "일부 잔고를 확인하지 못해 자동 반영을 보류했습니다. 계좌 관리에서 확인해 주세요.",
        409,
      );
    const applied = preview.changes.length
      ? await applyMeritzPreview(
          userId,
          preview.token,
          preview.changes.map((c) => c.key),
          client,
        )
      : {
          holdings: await listHoldings(userId, client),
          portfolio: await listPortfolio(userId, client),
          count: 0,
        };
    await client.query(
      "update portfolio.meritz_sync set last_success_at=$2,last_error=null,last_change_count=$3,updated_at=clock_timestamp() where user_id=$1",
      [userId, remote.fetchedAt, applied.count],
    );
    await client.query("commit");
    inTransaction = false;
    return {
      state: "synced",
      ...applied,
      sync: await meritzSyncStatus(userId, client),
    };
  } catch (e) {
    if (inTransaction) await client.query("rollback");
    const message =
      e instanceof MeritzImportError
        ? e.message
        : "메리츠 연결이 지연되어 기존 잔고를 유지합니다. 잠시 후 자동으로 다시 확인합니다.";
    if (locked)
      await client.query(
        "update portfolio.meritz_sync set last_error=$2 where user_id=$1 and lease_id=$3",
        [userId, message, leaseId],
      );
    return { state: "error", sync: await meritzSyncStatus(userId, client) };
  } finally {
    if (locked)
      await client
        .query(
          "update portfolio.meritz_sync set lease_id=null,lease_until=null where user_id=$1 and lease_id=$2",
          [userId, leaseId],
        )
        .catch(() => {});
    client.release();
  }
}

export async function disconnectMeritzSync(userId: string) {
  if (!meritzAvailable(userId))
    throw new MeritzImportError("접근할 수 없습니다.", 403);
  await db().query("delete from portfolio.meritz_sync where user_id=$1", [
    userId,
  ]);
  return meritzSyncStatus(userId);
}
