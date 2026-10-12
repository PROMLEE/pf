import { db } from "./db";
import { recordSnapshot } from "./portfolio-db";
import { listHoldings } from "./holdings-db";
import {
  calculatePositionTrade,
  PositionTradeError,
  type HoldingTradeInput,
} from "../app/position-trade";

export async function applyHoldingTrade(
  userId: string,
  id: string,
  trade: HoldingTradeInput,
) {
  const client = await db().connect();
  try {
    await client.query("begin");
    const result = await client.query<{
      quantity: string;
      average_cost: string | null;
      market: string;
      symbol: string;
      account_id: string;
      revision: string;
    }>(
      `select quantity, average_cost, market, symbol, account_id, xmin::text as revision from portfolio.holdings where user_id = $1 and id = $2 for update`,
      [userId, id],
    );
    const row = result.rows[0];
    if (!row) throw new PositionTradeError("보유 종목을 찾지 못했습니다.", 404);
    const current = {
      quantity: Number(row.quantity),
      averageCost: row.average_cost === null ? null : Number(row.average_cost),
    };
    const base = trade.expected;
    if (
      current.quantity !== base.quantity ||
      current.averageCost !== base.averageCost ||
      row.market !== base.market ||
      row.symbol !== base.symbol ||
      row.account_id !== base.accountId ||
      row.revision !== base.revision
    )
      throw new PositionTradeError(
        "보유 정보가 변경되었습니다. 새로고침 후 거래를 다시 입력해 주세요. 이미 반영한 거래는 다시 입력하지 마세요.",
        409,
      );
    const position = calculatePositionTrade(current, trade);
    if (position.quantity === 0)
      await client.query(
        `delete from portfolio.holdings where user_id = $1 and id = $2`,
        [userId, id],
      );
    else
      await client.query(
        `update portfolio.holdings set quantity = $3, average_cost = $4, updated_at = now() where user_id = $1 and id = $2`,
        [userId, id, position.quantity, position.averageCost],
      );
    await recordSnapshot(userId, client);
    const holdings = await listHoldings(userId, client);
    await client.query("commit");
    return { position, holdings };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
