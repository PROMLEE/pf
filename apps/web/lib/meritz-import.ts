import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "./db";
import { listHoldings } from "./holdings-db";
import { listPortfolio, recordSnapshot } from "./portfolio-db";
import { listAccounts } from "./accounts-db";
import { fetchMeritzBalance } from "./meritz";
import type { MeritzChange, MeritzPreview } from "../app/meritz-model";
export class MeritzImportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type Options = { accountId: string; krwAssetId: string; usdAssetId: string };
type PreviewData = {
  userId: string;
  options: Options;
  fingerprint: string;
  expiresAt: number;
  fetchedAt: string;
  changes: MeritzChange[];
};
const key = () => {
  if (!process.env.AUTH_SECRET || !process.env.MERITZ_APP_SECRET)
    throw Error("설정을 확인해 주세요.");
  return `${process.env.AUTH_SECRET}\0meritz-preview\0${process.env.MERITZ_APP_SECRET}`;
};
export function signPreview(data: PreviewData) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}
export function readPreview(token: string, userId: string): PreviewData {
  if (token.length > 500000)
    throw new MeritzImportError("미리보기를 다시 불러와 주세요.");
  const [body, signature, extra] = token.split(".");
  const actual = Buffer.from(signature || "", "base64url");
  const expected = createHmac("sha256", key())
    .update(body || "")
    .digest();
  if (
    extra ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw new MeritzImportError("미리보기를 다시 불러와 주세요.");
  let data: PreviewData;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    throw new MeritzImportError("미리보기를 다시 불러와 주세요.");
  }
  if (
    data.userId !== userId ||
    !Number.isFinite(data.expiresAt) ||
    data.expiresAt <= Date.now()
  )
    throw new MeritzImportError(
      "미리보기가 만료되었습니다. 잔고를 다시 불러와 주세요.",
      409,
    );
  return data;
}
async function state(
  userId: string,
  options: Options,
  client: Pick<PoolClient, "query"> = db(),
) {
  const account = (await listAccounts(userId, client)).find(
    (a) => a.id === options.accountId && a.broker.includes("메리츠"),
  );
  if (!account)
    throw new MeritzImportError("반영할 메리츠 계좌를 선택해 주세요.");
  const holdings = (await listHoldings(userId, client)).filter(
    (h) => h.accountId === account.id,
  );
  const cash = (
    await client.query<{
      id: string;
      account_id: string | null;
      name: string;
      value_krw: string;
      value_usd: string | null;
      average_fx_rate: string | null;
      bucket_id: string | null;
    }>(
      "select id,account_id,name,value_krw,value_usd,average_fx_rate,bucket_id from portfolio.manual_assets where user_id=$1 order by id",
      [userId],
    )
  ).rows;
  for (const [currency, id] of [
    ["KRW", options.krwAssetId],
    ["USD", options.usdAssetId],
  ]) {
    if (id === "skip") continue;
    const eligible = cash.filter(
      (c) =>
        (currency === "USD") === (c.value_usd !== null) &&
        (!c.account_id || c.account_id === account.id),
    );
    if (id === "new") {
      if (eligible.some((c) => c.account_id === account.id))
        throw new MeritzImportError(
          `${currency} 현금 자산이 이미 있습니다. 기존 자산을 선택해 주세요.`,
        );
    } else if (!eligible.some((c) => c.id === id))
      throw new MeritzImportError("현금 자산의 계좌와 통화를 확인해 주세요.");
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        account,
        holdings: holdings
          .map((h) => ({
            id: h.id,
            revision: h.revision,
            market: h.market,
            symbol: h.symbol,
            quantity: h.quantity,
            averageCost: h.averageCost,
            averageCostKrw: h.averageCostKrw,
            bucketId: h.bucketId,
            assignmentSource: h.assignmentSource,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        cash,
      }),
    )
    .digest("hex");
  return { account, holdings, cash, fingerprint };
}
export async function createMeritzPreview(
  userId: string,
  options: Options,
): Promise<MeritzPreview> {
  await state(userId, options); // Validate ownership before contacting the broker.
  const remote = await fetchMeritzBalance();
  const local = await state(userId, options);
  const changes: MeritzChange[] = [],
    warnings = [...remote.warnings];
  let unchanged = 0;
  for (const p of remote.positions) {
    const matches = local.holdings.filter(
      (h) => h.market === p.market && h.symbol === p.symbol,
    );
    if (matches.length > 1) {
      warnings.push(
        `${p.name}: 등록된 종목이 여러 건입니다. 계좌 관리에서 정리 후 다시 불러오세요.`,
      );
      continue;
    }
    const before = matches[0];
    if (
      before &&
      before.quantity === p.quantity &&
      before.averageCost === p.averageCost
    ) {
      unchanged++;
      continue;
    }
    changes.push({
      key: `stock:${p.market}:${p.symbol}`,
      kind: "stock",
      name: p.name,
      currency: p.market === "US" ? "USD" : "KRW",
      id: before?.id ?? null,
      before: before?.quantity ?? null,
      after: p.quantity,
      beforeCost: before?.averageCost ?? null,
      position: p,
    });
  }
  // Never infer sales from omitted/unsupported broker rows. Absences require manual review.
  const keys = new Set(remote.positions.map((p) => `${p.market}:${p.symbol}`));
  for (const h of local.holdings)
    if (!keys.has(`${h.market}:${h.symbol}`))
      warnings.push(
        `${h.name}: 불러온 목록에 없어 그대로 유지합니다. 매도·지원 제외 여부를 직접 확인하세요.`,
      );
  for (const currency of ["KRW", "USD"] as const) {
    const id = currency === "KRW" ? options.krwAssetId : options.usdAssetId;
    if (id === "skip") continue;
    const before = local.cash.find((c) => c.id === id);
    const balance = before
      ? Number(currency === "USD" ? before.value_usd : before.value_krw)
      : null;
    if (balance === remote.cash[currency]) {
      unchanged++;
      continue;
    }
    changes.push({
      key: `cash:${currency}`,
      kind: "cash",
      id: before?.id ?? null,
      name:
        before?.name ??
        `${local.account.name} ${currency === "USD" ? "달러" : "원화"}`,
      currency,
      before: balance,
      after: remote.cash[currency],
    });
  }
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const payload = {
    userId,
    options,
    fingerprint: local.fingerprint,
    expiresAt,
    fetchedAt: remote.fetchedAt,
    changes,
  };
  return {
    token: signPreview(payload),
    accountName: local.account.name,
    fetchedAt: remote.fetchedAt,
    expiresAt,
    changes,
    unchanged,
    warnings,
  };
}
export async function applyMeritzPreview(
  userId: string,
  token: string,
  selected: string[],
) {
  const preview = readPreview(token, userId);
  if (
    !selected.length ||
    selected.length > 500 ||
    new Set(selected).size !== selected.length ||
    selected.some((k) => !preview.changes.some((c) => c.key === k))
  )
    throw new MeritzImportError("반영할 변경 사항을 선택해 주세요.");
  const client = await db().connect();
  try {
    await client.query("begin");
    const plan = (
      await client.query<{ usd_krw: string }>(
        "select usd_krw from portfolio.plans where user_id=$1 for update",
        [userId],
      )
    ).rows[0];
    if (!plan)
      throw new MeritzImportError(
        "목표 설계에서 포트폴리오를 먼저 만들어 주세요.",
      );
    await client.query(
      "select id from portfolio.accounts where user_id=$1 and id=$2 for update",
      [userId, preview.options.accountId],
    );
    await client.query(
      "select id from portfolio.holdings where user_id=$1 and account_id=$2 order by id for update",
      [userId, preview.options.accountId],
    );
    await client.query(
      "select id from portfolio.manual_assets where user_id=$1 order by id for update",
      [userId],
    );
    readPreview(token, userId); // Check expiry again after acquiring transaction locks.
    const local = await state(userId, preview.options, client);
    if (local.fingerprint !== preview.fingerprint)
      throw new MeritzImportError(
        "미리보기 이후 자산이 변경되었습니다. 잔고를 다시 불러와 비교해 주세요. 이미 반영한 내용은 중복 저장하지 않습니다.",
        409,
      );
    const chosen = preview.changes.filter((c) => selected.includes(c.key));
    for (const change of chosen) {
      if (change.kind === "stock" && change.position) {
        const p = change.position;
        if (change.id) {
          // Preserve identity, portfolio assignment and historical acquisition FX.
          await client.query(
            "update portfolio.holdings set quantity=$3,average_cost_krw=case when average_cost>0 and average_cost_krw is not null then $4*average_cost_krw/average_cost else average_cost_krw end,average_cost=$4,captured_price=$5,captured_at=$6,updated_at=now() where user_id=$1 and id=$2",
            [
              userId,
              change.id,
              p.quantity,
              p.averageCost,
              p.price,
              preview.fetchedAt,
            ],
          );
        } else {
          const rule = (
            await client.query<{ bucket_id: string }>(
              "select bucket_id from portfolio.rules where user_id=$1 and market=$2 and symbol=$3 limit 1",
              [userId, p.market, p.symbol],
            )
          ).rows[0];
          await client.query(
            "insert into portfolio.holdings(id,user_id,account_id,broker,account_label,market,symbol,name,exchange_code,quantity,average_cost,captured_price,captured_at,bucket_id,assignment_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'auto')",
            [
              randomUUID(),
              userId,
              local.account.id,
              local.account.broker,
              local.account.name,
              p.market,
              p.symbol,
              p.name,
              p.exchange,
              p.quantity,
              p.averageCost,
              p.price,
              preview.fetchedAt,
              rule?.bucket_id ?? null,
            ],
          );
        }
      } else if (change.kind === "cash") {
        const valueKrw =
          change.currency === "USD"
            ? change.after * Number(plan.usd_krw)
            : change.after;
        if (change.id)
          await client.query(
            "update portfolio.manual_assets set value_krw=$3,value_usd=$4,account_id=$5,updated_at=now() where user_id=$1 and id=$2",
            [
              userId,
              change.id,
              valueKrw,
              change.currency === "USD" ? change.after : null,
              local.account.id,
            ],
          );
        else
          await client.query(
            "insert into portfolio.manual_assets(id,user_id,account_id,name,value_krw,value_usd) values($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              userId,
              local.account.id,
              change.name,
              valueKrw,
              change.currency === "USD" ? change.after : null,
            ],
          );
      }
    }
    if (chosen.some((c) => c.kind === "cash"))
      await client.query(
        "update portfolio.plans set cash_revision=cash_revision+1 where user_id=$1",
        [userId],
      );
    await recordSnapshot(userId, client);
    const holdings = await listHoldings(userId, client),
      portfolio = await listPortfolio(userId, client);
    await client.query("commit");
    return { holdings, portfolio, count: chosen.length };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
