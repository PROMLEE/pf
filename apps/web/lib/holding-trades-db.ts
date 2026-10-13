import { db } from "./db";
import { recordSnapshot, listPortfolio } from "./portfolio-db";
import { listHoldings } from "./holdings-db";
import {
  calculatePositionTrade,
  calculateTradeCash,
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
    const plan = trade.cash
      ? await client.query<{ usd_krw: string }>(
          `select usd_krw from portfolio.plans where user_id = $1 for update`,
          [userId],
        )
      : null;
    if (trade.cash && !plan?.rows[0])
      throw new PositionTradeError("포트폴리오를 찾지 못했습니다.", 404);
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
    let cashChange: {
      name: string;
      balance: number;
      delta: number;
      currency: string;
    } | null = null;
    if (trade.cash) {
      const cashResult = await client.query<{
        name: string;
        value_krw: string;
        value_usd: string | null;
      }>(
        `select name, value_krw, value_usd from portfolio.manual_assets where user_id = $1 and id = $2 for update`,
        [userId, trade.cash.assetId],
      );
      const cash = cashResult.rows[0];
      if (!cash)
        throw new PositionTradeError(
          "선택한 현금 자산을 찾지 못했습니다.",
          404,
        );
      if ((row.market === "US") !== (cash.value_usd !== null))
        throw new PositionTradeError(
          "국내 주식은 원화, 미국 주식은 달러 자산을 선택해 주세요.",
        );
      const balance = Number(cash.value_usd ?? cash.value_krw);
      if (balance !== trade.cash.expectedBalance)
        throw new PositionTradeError(
          "현금 잔고가 변경되었습니다. 수정 화면을 다시 열어 주세요.",
          409,
        );
      const change = calculateTradeCash(
        balance,
        trade,
        row.market as "KR" | "US",
      );
      await client.query(
        `update portfolio.manual_assets set value_krw = $3, value_usd = $4, updated_at = now() where user_id = $1 and id = $2`,
        [
          userId,
          trade.cash.assetId,
          row.market === "US"
            ? change.balance * Number(plan!.rows[0].usd_krw)
            : change.balance,
          row.market === "US" ? change.balance : null,
        ],
      );
      cashChange = {
        name: cash.name,
        ...change,
        currency: row.market === "US" ? "USD" : "KRW",
      };
    }
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
    const portfolio = trade.cash ? await listPortfolio(userId, client) : null;
    await client.query("commit");
    return { position, holdings, portfolio, cashChange };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
