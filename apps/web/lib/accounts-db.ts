import type { PoolClient } from "pg";
import { db } from "./db";
import type { BrokerageAccount } from "../app/accounts-model";

type Client = Pick<PoolClient, "query">;
export async function listAccounts(
  userId: string,
  client: Client = db(),
): Promise<BrokerageAccount[]> {
  const result = await client.query<BrokerageAccount>(
    `select id,broker,name from portfolio.accounts where user_id=$1 order by broker,name`,
    [userId],
  );
  return result.rows;
}
export async function resolveAccount(
  client: Client,
  userId: string,
  broker: string,
  name: string,
  id?: string,
) {
  if (id) {
    const result = await client.query<BrokerageAccount>(
      `select id,broker,name from portfolio.accounts where user_id=$1 and id=$2 for update`,
      [userId, id],
    );
    if (!result.rows[0]) throw new Error("계좌를 찾지 못했습니다.");
    return result.rows[0];
  }
  const result = await client.query<BrokerageAccount>(
    `insert into portfolio.accounts(user_id,broker,name) values($1,$2,$3)
    on conflict(user_id,lower(broker),lower(name)) do update set updated_at=portfolio.accounts.updated_at returning id,broker,name`,
    [userId, broker.trim(), name.trim()],
  );
  return result.rows[0];
}
export async function createAccount(
  userId: string,
  broker: string,
  name: string,
) {
  return resolveAccount(db(), userId, broker, name);
}
export async function updateAccount(
  userId: string,
  id: string,
  broker: string,
  name: string,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update portfolio.accounts set broker=$3,name=$4,updated_at=now() where user_id=$1 and id=$2 returning id`,
      [userId, id, broker.trim(), name.trim()],
    );
    if (!result.rowCount) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      `update portfolio.holdings set broker=$3,account_label=$4,updated_at=now() where user_id=$1 and account_id=$2`,
      [userId, id, broker.trim(), name.trim()],
    );
    const accounts = await listAccounts(userId, client);
    await client.query("commit");
    return { accounts };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
