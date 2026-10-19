"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Plus, RefreshCw } from "lucide-react";
import AssetIcon from "./AssetIcon";
import RunReplacementForm from "./RunReplacementForm";
import NumberInput from "./NumberInput";
import type { Holding } from "./holdings";
import type { AssetSelection } from "./PortfolioBuilder";
import type { Portfolio } from "./portfolio-model";
import type { BrokerageAccount } from "./accounts-model";
import {
  runItemProgress,
  runPortfolioOverview,
  type RebalanceRun,
  type RunConfig,
  type RunItem,
  type RunExecution,
} from "./rebalance-runs";
import styles from "./RebalancePlans.module.css";
const quantity = (n: number) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const date = (s: string) =>
  new Date(s).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const statusName = { active: "진행 중", completed: "완료", cancelled: "중단" };
type Saved = {
  holdings: Holding[];
  portfolio: Portfolio;
  alreadyRecorded?: boolean;
};
type Listing = {
  active: RebalanceRun | null;
  history: RebalanceRun[];
  nextOffset: number | null;
};
async function post(body: unknown) {
  const r = await fetch("/api/rebalance-plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const error = Object.assign(Error(data.message ?? "저장하지 못했습니다."), {
      status: r.status,
    });
    throw error;
  }
  return data;
}

function RunTradeForm({
  run,
  item,
  portfolio,
  holdings,
  onSaved,
  onCancel,
  onDirty,
}: {
  run: RebalanceRun;
  item: RunItem;
  portfolio: Portfolio;
  holdings: Holding[];
  onSaved: (data: Saved) => Promise<void>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const remaining = runItemProgress(item, run.fills).remaining;
  const [qty, setQty] = useState(String(remaining));
  const original = holdings.find((h) => h.id === item.holdingId);
  const lastLinkedHolding = [...run.fills]
    .reverse()
    .filter((f) => f.itemId === item.id)
    .map((f) => holdings.find((h) => h.id === f.holdingId))
    .find(Boolean);
  const crypto = portfolio.cryptoAssets.find((c) => c.id === item.assetId);
  const [price, setPrice] = useState(
    String(
      original?.currentPrice ??
        lastLinkedHolding?.currentPrice ??
        crypto?.quotedPriceKrw ??
        item.unitPrice,
    ),
  );
  const [fee, setFee] = useState("");
  const [fx, setFx] = useState(String(portfolio.usdKrw));
  const [accountId, setAccountId] = useState(
    item.accountId ?? lastLinkedHolding?.accountId ?? "",
  );
  const [accounts, setAccounts] = useState<BrokerageAccount[]>([]);
  const [reflectCash, setReflectCash] = useState(false);
  const [cashId, setCashId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ id: string; body: RunExecution } | null>(null);
  const cashAssets = portfolio.manualAssets.filter(
    (c) => (c.valueUsd !== null) === (item.currency === "USD"),
  );
  const cash = cashAssets.find((c) => c.id === cashId);
  const held =
    original ??
    (item.kind === "stock"
      ? holdings.find(
          (h) =>
            h.accountId === accountId &&
            h.market === item.market &&
            h.symbol === item.symbol,
        )
      : undefined);
  useEffect(() => {
    onDirty(true);
    return () => onDirty(false);
  }, [onDirty]);
  useEffect(() => {
    if (item.kind !== "stock" || item.accountId) return;
    let live = true;
    void fetch("/api/accounts", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("계좌 목록을 불러오지 못했습니다.");
        const data = await r.json();
        if (live) setAccounts(data.accounts);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [item.kind, item.accountId]);
  const unit = item.kind === "stock" ? "주" : item.symbol.replace("KRW-", "");
  const gross =
    Number(qty) * Number(price) +
    (item.side === "buy" ? 1 : -1) * Number(fee || 0);
  const cashAfter = cash
    ? (cash.valueUsd ?? cash.valueKrw) + (item.side === "buy" ? -gross : gross)
    : null;
  const insufficientCash = reflectCash && cashAfter !== null && cashAfter < 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || insufficientCash) return;
    setBusy(true);
    setError("");
    const body: RunExecution = {
      requestId: request.current?.id ?? window.crypto.randomUUID(),
      runId: run.id,
      itemId: item.id,
      revision: run.revision,
      quantity: Number(qty),
      price: Number(price),
      fee: Number(fee || 0),
      fxRate: Number(fx),
      accountId: item.kind === "stock" ? accountId || null : null,
      expectedQuantity: held?.quantity ?? crypto?.quantity ?? 0,
      expectedRevision: held?.revision,
      cash:
        reflectCash && cash
          ? {
              assetId: cash.id,
              expectedBalance: cash.valueUsd ?? cash.valueKrw,
            }
          : null,
    };
    // A retry after an uncertain response reuses the exact original payload.
    if (
      request.current &&
      JSON.stringify({ ...body, requestId: "" }) !==
        JSON.stringify({ ...request.current.body, requestId: "" })
    ) {
      setError(
        "이전 저장 결과를 먼저 확인해 주세요. 닫고 새로고침하면 최신 진행 상태를 확인할 수 있습니다.",
      );
      setBusy(false);
      return;
    }
    request.current = { id: body.requestId, body };
    try {
      const data = await post({ action: "execute", execution: body });
      await onSaved(data);
    } catch (e) {
      if (e && typeof e === "object" && "status" in e && Number(e.status) < 500)
        request.current = null;
      setError(e instanceof Error ? e.message : "거래를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.tradeForm}
      onSubmit={submit}
      aria-label={`${item.name} 계획 거래 입력`}
    >
      <strong>
        {item.name} · 실제 {item.side === "buy" ? "매수" : "매도"} 내역
      </strong>
      <p>저장하면 보유 자산과 계획 진행률에 함께 반영됩니다.</p>
      <fieldset disabled={busy}>
        {item.kind === "stock" && !item.accountId && (
          <label>
            거래 계좌
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              <option value="">계좌 선택</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.broker} · {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.inputGrid}>
          <label>
            이번 실행 수량 · {unit}
            <NumberInput
              value={qty}
              onValueChange={setQty}
              min={item.kind === "crypto" ? "0.00000001" : "0.000001"}
              max={String(remaining)}
              step="any"
              required
            />
          </label>
          <label>
            실제 체결 단가 · {item.currency}
            <NumberInput
              value={price}
              onValueChange={setPrice}
              min="0.00000001"
              step="any"
              required
            />
          </label>
          <label>
            수수료 · {item.currency}
            <NumberInput
              value={fee}
              onValueChange={setFee}
              min="0"
              step="any"
              placeholder="0"
            />
          </label>
          {item.currency === "USD" && (
            <label>
              이번 거래 환율 · 원/USD
              <NumberInput
                value={fx}
                onValueChange={setFx}
                min="100"
                max="100000"
                step="any"
                required
              />
            </label>
          )}
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={reflectCash}
            onChange={(e) => {
              setReflectCash(e.target.checked);
              if (!cashId && cashAssets.length === 1)
                setCashId(cashAssets[0].id);
            }}
          />
          현금 잔고에도 반영
        </label>
        {reflectCash && (
          <label>
            거래 현금
            <select
              value={cashId}
              onChange={(e) => setCashId(e.target.value)}
              required
            >
              <option value="">현금 자산 선택</option>
              {cashAssets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {(c.valueUsd ?? c.valueKrw).toLocaleString()}{" "}
                  {item.currency}
                </option>
              ))}
            </select>
            {!cashAssets.length && (
              <span>같은 통화의 현금 자산을 먼저 등록해 주세요.</span>
            )}
          </label>
        )}
        <div className={styles.checkAmount}>
          예상 {item.side === "buy" ? "지출" : "입금"}{" "}
          <strong>
            {Number.isFinite(gross)
              ? gross.toLocaleString("ko-KR", { maximumFractionDigits: 6 })
              : "—"}{" "}
            {item.currency}
          </strong>
        </div>
        {!reflectCash && <p>현금 잔고는 바꾸지 않습니다.</p>}
      </fieldset>
      {insufficientCash && (
        <p className={styles.error} role="status">
          선택한 현금 잔고가 부족합니다. 수량이나 현금 자산을 확인하세요.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primary}
          disabled={busy || (reflectCash && !cash) || insufficientCash}
        >
          {busy ? "저장 중…" : "거래 반영"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}
function RunDetail({
  run,
  portfolio,
  holdings,
  onExecute,
  onCancelRun,
  onDirty,
  disabled,
  onSelectAsset,
  onChangeRun,
}: {
  run: RebalanceRun;
  portfolio: Portfolio;
  holdings: Holding[];
  onExecute: (data: Saved) => Promise<void>;
  onCancelRun: () => void;
  onDirty: (v: boolean) => void;
  disabled: boolean;
  onSelectAsset: (asset: AssetSelection) => void;
  onChangeRun: (run: RebalanceRun) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const locked = editing !== null || changing !== null;
  const overview = runPortfolioOverview(run, portfolio, holdings);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const pending = run.snapshot.items
    .filter((i) => !runItemProgress(i, run.fills).done)
    .sort((a, b) => Number(a.side === "buy") - Number(b.side === "buy"));
  const completed = run.snapshot.items.filter(
    (i) => runItemProgress(i, run.fills).done,
  );
  const renderItem = (item: RunItem) => {
    const progress = runItemProgress(item, run.fills);
    const bucket = overview.find((b) => b.id === item.bucketId);
    const unit = item.kind === "stock" ? "주" : item.symbol.replace("KRW-", "");
    const currentHolding =
      holdings.find((h) => h.id === item.holdingId) ??
      [...run.fills]
        .reverse()
        .filter((f) => f.itemId === item.id)
        .map((f) => holdings.find((h) => h.id === f.holdingId))
        .find(Boolean);
    const candidate = portfolio.rules.find(
      (r) =>
        r.bucketId === item.bucketId &&
        r.market === item.market &&
        r.symbol === item.symbol,
    );
    const asset: AssetSelection | null =
      item.kind === "crypto"
        ? portfolio.cryptoAssets.some((c) => c.id === item.assetId)
          ? { kind: "crypto", id: `crypto:${item.assetId}` }
          : null
        : currentHolding
          ? { kind: "stock", id: `holding:${currentHolding.id}` }
          : candidate
            ? { kind: "candidate", id: candidate.id }
            : null;
    return (
      <div key={item.id} className={styles.item}>
        <div className={styles.itemLine}>
          <AssetIcon
            kind={item.kind}
            market={item.market}
            symbol={item.symbol}
            exchange={item.exchange}
            name={item.name}
          />
          <div className={styles.security}>
            {run.status === "active" && asset ? (
              <button
                type="button"
                className={styles.securityName}
                disabled={disabled || locked}
                aria-label={`${item.name} 자산 상세`}
                onClick={() => onSelectAsset(asset)}
              >
                {item.name}
              </button>
            ) : (
              <strong>{item.name}</strong>
            )}
            <small>
              {item.bucketName}
              {item.account ? ` · ${item.account}` : ""}
            </small>
            {run.status === "active" && bucket && (
              <small>
                현재 {bucket.current.toFixed(2)}% → 계획 후{" "}
                {bucket.projected.toFixed(2)}% · 목표{" "}
                {bucket.targetPercent.toFixed(2)}%
              </small>
            )}
            <small>
              계획 {quantity(item.quantity)}
              {unit}
              {progress.executed > 0
                ? ` · 반영 ${quantity(progress.executed)}${unit}`
                : ""}
            </small>
          </div>
          <div className={styles.order}>
            <strong className={item.side === "buy" ? styles.buy : styles.sell}>
              {progress.done ? (
                <>
                  <Check size={14} /> 완료
                </>
              ) : (
                <>
                  {quantity(progress.remaining)}
                  {unit} {item.side === "buy" ? "매수" : "매도"}
                </>
              )}
            </strong>
            {run.status === "active" && !progress.done && (
              <button
                type="button"
                disabled={disabled || locked}
                onClick={() => {
                  setConfirmCancel(false);
                  setEditing(item.id);
                }}
                aria-label={`${item.bucketName} ${item.name} ${item.side === "buy" ? "매수" : "매도"} 거래 입력`}
              >
                거래 입력 <ArrowRight size={13} />
              </button>
            )}
            {run.status === "active" && !progress.done && (
              <button
                type="button"
                className={styles.changeSecurity}
                disabled={disabled || locked}
                onClick={() => {
                  setConfirmCancel(false);
                  setChanging(item.id);
                }}
                aria-label={`${item.bucketName} ${item.name} 종목 변경`}
              >
                종목 변경
              </button>
            )}
          </div>
        </div>
        {changing === item.id && (
          <RunReplacementForm
            run={run}
            item={item}
            portfolio={portfolio}
            holdings={holdings}
            onDirty={onDirty}
            onCancel={() => setChanging(null)}
            onSaved={(next) => {
              setChanging(null);
              onChangeRun(next);
            }}
          />
        )}
        {editing === item.id && (
          <RunTradeForm
            key={item.id}
            run={run}
            item={item}
            portfolio={portfolio}
            holdings={holdings}
            onDirty={onDirty}
            onCancel={() => setEditing(null)}
            onSaved={async (data) => {
              setEditing(null);
              await onExecute(data);
            }}
          />
        )}
      </div>
    );
  };
  return (
    <section className={styles.detail}>
      <div className={styles.detailHead}>
        <div>
          <h2>
            {run.status === "active"
              ? "진행 중인 계획"
              : `${statusName[run.status]}한 계획`}
          </h2>
          <small>{date(run.createdAt)} 확정</small>
        </div>
        <strong>
          {completed.length}/{run.snapshot.items.length} 완료
        </strong>
      </div>
      <progress
        className={styles.progress}
        max={run.snapshot.items.length}
        value={completed.length}
        aria-label="계획 진행률"
      />
      <div className={styles.meta}>
        <span>추가 투입금 {won(run.snapshot.newCash)}</span>
        {run.status === "active" && (
          <span>확정 수량 기준 · 자동 재계산 안 함</span>
        )}
        {run.endedAt && <span>{date(run.endedAt)} 종료</span>}
      </div>
      {pending.length > 0 && (
        <div>
          <h3>
            {run.status === "active" ? "남은 거래" : "실행하지 않은 거래"}
          </h3>
          {pending.map(renderItem)}
        </div>
      )}
      {completed.length > 0 && (
        <details className={styles.disclosure} open={run.status !== "active"}>
          <summary>
            완료한 거래 {completed.length}건 <ChevronDown size={14} />
          </summary>
          {completed.map(renderItem)}
        </details>
      )}
      {run.status === "active" && (
        <section className={styles.otherPortfolios} aria-label="다른 포트 안내">
          <h3>다른 포트</h3>
          {overview
            .filter((b) => !b.pending)
            .map((b) => (
              <div key={b.id} className={styles.portfolioGuide}>
                <strong>
                  <i style={{ background: b.color }} />
                  {b.name}
                </strong>
                <span>
                  현재 {b.current.toFixed(2)}% · 목표{" "}
                  {b.targetPercent.toFixed(2)}%
                </span>
                <small>
                  계획 예상 {b.projected.toFixed(2)}% · {b.message}
                </small>
              </div>
            ))}
          {overview.every((b) => b.pending) && (
            <p>모든 포트의 남은 거래가 위에 표시되어 있습니다.</p>
          )}
        </section>
      )}
      <details className={styles.disclosure}>
        <summary>
          {run.outcome ? "최종 결과 · 목표 비중 비교" : "확정 당시 예상 비중"}{" "}
          <ChevronDown size={14} />
        </summary>
        <p>
          확정 당시 총자산 {won(run.snapshot.currentTotal)} · 적용 환율{" "}
          {quantity(run.snapshot.usdKrw)}원/USD
        </p>
        {run.outcome && (
          <p>
            종료 시 총자산 {won(run.outcome.total)} ·{" "}
            {date(run.outcome.capturedAt)}
          </p>
        )}
        {run.outcome?.configurationChanged && (
          <p>
            진행 중 포트 구성이 변경됐습니다. 확정 당시 목표와 종료 시 실제
            비중을 비교합니다.
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>포트</th>
              <th>목표</th>
              <th>확정 예상</th>
              {run.outcome && <th>종료 실제</th>}
            </tr>
          </thead>
          <tbody>
            {run.snapshot.projected.map((b) => (
              <tr key={b.id}>
                <th>{b.name}</th>
                <td>{b.targetPercent.toFixed(2)}%</td>
                <td>{b.percent.toFixed(2)}%</td>
                {run.outcome && (
                  <td>
                    {(
                      run.outcome.weights.find((w) => w.id === b.id)?.percent ??
                      0
                    ).toFixed(2)}
                    %
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {Boolean(run.snapshot.changes?.length) && (
        <details className={styles.disclosure}>
          <summary>
            종목 변경 이력 {run.snapshot.changes!.length}건{" "}
            <ChevronDown size={14} />
          </summary>
          {run.snapshot.changes!.map((change) => (
            <div key={change.id} className={styles.changeHistory}>
              <strong>
                {change.from.bucketName} ·{" "}
                {change.from.side === "buy" ? "매수" : "매도"}
              </strong>
              <span>
                {change.from.name} → {change.to.name}{" "}
                {quantity(change.to.quantity)}
                {change.to.kind === "stock" ? "주" : "개"}
              </span>
              <small>
                {date(change.createdAt)}
                {change.executedQuantity > 0
                  ? ` · 이전 종목 ${quantity(change.executedQuantity)} 반영 내역 유지`
                  : ""}
              </small>
            </div>
          ))}
        </details>
      )}
      <details className={styles.disclosure}>
        <summary>
          실행 내역 {run.fills.length}건 <ChevronDown size={14} />
        </summary>
        {!run.fills.length && <p>아직 입력한 거래가 없습니다.</p>}
        {run.fills.map((f) => {
          const item = run.snapshot.items.find((i) => i.id === f.itemId);
          return (
            <div key={f.id} className={styles.fill}>
              <span>
                <strong>
                  {item?.name} {item?.side === "buy" ? "매수" : "매도"}
                </strong>
                <small>
                  {date(f.createdAt)} 입력
                  {f.source === "holding-editor" ? " · 자산 상세에서 입력" : ""}
                </small>
              </span>
              <span>
                {quantity(f.quantity)}
                {item?.kind === "stock" ? "주" : ""}
                <small>
                  단가 {quantity(f.price)} {f.currency} · 수수료{" "}
                  {quantity(f.fee)}
                </small>
              </span>
            </div>
          );
        })}
      </details>
      {run.status === "active" && confirmCancel && (
        <div
          className={styles.cancelConfirm}
          role="group"
          aria-label="계획 중단 확인"
        >
          <p>남은 제안을 중단할까요? 이미 반영한 거래와 자산은 유지됩니다.</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={disabled || locked}
              onClick={onCancelRun}
            >
              계획 중단 확인
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setConfirmCancel(false)}
            >
              계속 진행
            </button>
          </div>
        </div>
      )}
      {run.status === "active" && !confirmCancel && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelRun}
            disabled={disabled || locked}
            onClick={() => setConfirmCancel(true)}
          >
            계획 중단
          </button>
          <small>중단해도 반영한 거래와 자산은 유지됩니다.</small>
        </div>
      )}
    </section>
  );
}
export default function RebalancePlans({
  userId,
  config,
  portfolio,
  holdings,
  canStart,
  disabled,
  onPreviewChange,
  onSaved,
  onDirty,
  onNewPlan,
  onSelectAsset,
}: {
  userId: string;
  config: RunConfig;
  portfolio: Portfolio;
  holdings: Holding[];
  canStart: boolean;
  disabled: boolean;
  onPreviewChange: (v: boolean) => void;
  onSaved: (data: Saved, message: string) => void;
  onDirty: (v: boolean) => void;
  onNewPlan: () => void;
  onSelectAsset: (asset: AssetSelection) => void;
}) {
  const [listing, setListing] = useState<Listing>({
    active: null,
    history: [],
    nextOffset: null,
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [tab, setTab] = useState<"current" | "history">("current");
  const [selected, setSelected] = useState<RebalanceRun | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const startId = useRef<string | null>(null);
  const activeRunId = useRef<string | undefined>(undefined);
  const reload = useCallback(async (lastRunId?: string) => {
    const r = await fetch("/api/rebalance-plans", { cache: "no-store" });
    if (!r.ok) throw Error("계획 이력을 불러오지 못했습니다.");
    const data: Listing = await r.json();
    activeRunId.current = data.active?.id;
    setListing(data);
    if (lastRunId && !data.active) {
      const ended = data.history.find((x) => x.id === lastRunId);
      if (ended) {
        setSelected(ended);
        setTab("history");
      }
    }
    setError("");
    setLoading(false);
    return data;
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setSelected(null);
    setTab("current");
    void fetch("/api/rebalance-plans", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("계획 이력을 불러오지 못했습니다.");
        const data: Listing = await r.json();
        if (live) {
          activeRunId.current = data.active?.id;
          setListing(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    const updated = () => {
      void reload(activeRunId.current).catch((e) => setError(e.message));
    };
    window.addEventListener("pf-rebalance-run-updated", updated);
    return () => {
      live = false;
      window.removeEventListener("pf-rebalance-run-updated", updated);
    };
  }, [userId, reload]);
  useEffect(() => {
    onPreviewChange(
      !loading && !listing.active && tab === "current" && !selected && !error,
    );
  }, [loading, listing.active, tab, selected, error, onPreviewChange]);
  useEffect(() => {
    onDirty(formDirty || busy);
    return () => onDirty(false);
  }, [formDirty, busy, onDirty]);
  async function start() {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    startId.current ??= window.crypto.randomUUID();
    try {
      const data = await post({ action: "start", id: startId.current, config });
      startId.current = null;
      activeRunId.current = data.run.id;
      setListing((current) => ({ ...current, active: data.run }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "계획을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    const run = listing.active;
    if (!run || busy) return;
    setBusy(true);
    try {
      await post({ action: "cancel", id: run.id, revision: run.revision });
      await reload(run.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "계획 중단 실패");
    } finally {
      setBusy(false);
    }
  }
  async function saved(data: Saved) {
    const id = listing.active?.id;
    onSaved(
      data,
      data.alreadyRecorded
        ? "이미 반영된 거래입니다. 진행 상태를 확인하세요."
        : "거래를 반영했습니다. 남은 계획 수량을 확인하세요.",
    );
    try {
      await reload(id);
    } catch {
      setError(
        "거래는 저장됐지만 진행 목록을 갱신하지 못했습니다. 새로고침해 주세요.",
      );
    }
  }
  return (
    <div className={styles.wrapper}>
      <div className={styles.nav}>
        <button
          type="button"
          className={tab === "current" ? styles.selected : ""}
          aria-pressed={tab === "current"}
          disabled={busy || formDirty}
          onClick={() => {
            if (!listing.active) onNewPlan();
            setTab("current");
            setSelected(null);
          }}
        >
          {listing.active ? "진행 중" : "새 계획"}
        </button>
        <button
          type="button"
          className={tab === "history" ? styles.selected : ""}
          aria-pressed={tab === "history"}
          disabled={busy || formDirty}
          onClick={() => {
            setTab("history");
            setSelected(null);
          }}
        >
          계획 이력
        </button>
        <button
          type="button"
          className={styles.refresh}
          aria-label="계획 이력 새로고침"
          disabled={busy || formDirty || loading}
          onClick={() => {
            setLoading(true);
            void reload().catch((e) => {
              setError(e.message);
              setLoading(false);
            });
          }}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {loading && <p role="status">계획 불러오는 중…</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!loading &&
        tab === "current" &&
        (listing.active ? (
          <RunDetail
            run={listing.active}
            portfolio={portfolio}
            holdings={holdings}
            onExecute={saved}
            onDirty={setFormDirty}
            disabled={busy || disabled}
            onCancelRun={cancel}
            onChangeRun={(next) =>
              setListing((current) => ({ ...current, active: next }))
            }
            onSelectAsset={onSelectAsset}
          />
        ) : (
          <div className={styles.start}>
            <div>
              <strong>제안을 확정하고 순서대로 진행하세요.</strong>
              <small>시세가 변해도 계획 수량은 유지됩니다.</small>
            </div>
            <button
              type="button"
              className={styles.primary}
              disabled={!canStart || busy || disabled || Boolean(error)}
              onClick={start}
            >
              {busy ? "확정 중…" : "이 계획으로 시작"}
              <ArrowRight size={15} />
            </button>
          </div>
        ))}
      {!loading && tab === "history" && (
        <section className={styles.history}>
          {selected ? (
            <>
              <button
                type="button"
                className={styles.back}
                onClick={() => setSelected(null)}
              >
                ← 이력 목록
              </button>
              <RunDetail
                key={selected.id}
                run={selected}
                portfolio={portfolio}
                holdings={holdings}
                onExecute={saved}
                onDirty={setFormDirty}
                disabled
                onCancelRun={() => {}}
                onChangeRun={() => {}}
                onSelectAsset={onSelectAsset}
              />
              <button
                type="button"
                className={styles.primary}
                disabled={Boolean(listing.active)}
                onClick={() => {
                  onNewPlan();
                  setSelected(null);
                  setTab("current");
                }}
              >
                <Plus size={15} />새 계획 계산
              </button>
            </>
          ) : (
            <>
              <h2>리밸런싱 이력</h2>
              {!listing.history.length && (
                <p>완료하거나 중단한 계획이 여기에 쌓입니다.</p>
              )}
              {listing.history.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  className={styles.historyRow}
                  onClick={() => setSelected(run)}
                >
                  <span>
                    <strong>{date(run.createdAt)}</strong>
                    <small>
                      {run.snapshot.title} · 추가금 {won(run.snapshot.newCash)}
                    </small>
                  </span>
                  <span>
                    <strong>{statusName[run.status]}</strong>
                    <small>
                      {
                        run.snapshot.items.filter(
                          (i) => runItemProgress(i, run.fills).done,
                        ).length
                      }
                      /{run.snapshot.items.length} 완료
                    </small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
              {listing.nextOffset !== null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await fetch(
                        `/api/rebalance-plans?offset=${listing.nextOffset}`,
                        { cache: "no-store" },
                      );
                      if (!r.ok) throw Error("이력을 불러오지 못했습니다.");
                      const more: Listing = await r.json();
                      setListing((current) => ({
                        ...current,
                        history: [
                          ...new Map(
                            [...current.history, ...more.history].map((run) => [
                              run.id,
                              run,
                            ]),
                          ).values(),
                        ],
                        nextOffset: more.nextOffset,
                      }));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "조회 실패");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  이전 이력 더 보기
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
