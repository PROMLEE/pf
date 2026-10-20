"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ChevronDown,
} from "lucide-react";
import type { Portfolio, ManualAsset } from "./portfolio-model";
import type { BrokerageAccount } from "./accounts-model";
import {
  transferBalances,
  type CashTransferInput,
  type CashMovementKind,
} from "./cash-transfer";
import NumberInput from "./NumberInput";
import styles from "./CashTransfers.module.css";
type Entry = {
  id: string;
  kind?: CashMovementKind;
  source_name: string;
  destination_name: string;
  currency: "KRW" | "USD";
  amount: string;
  note: string;
  created_at: string;
};
const names = {
  deposit: "외부 입금",
  withdrawal: "외부 출금",
  transfer: "내 계좌 간 이체",
};
const money = (value: number, usd: boolean) =>
  `${usd ? "$" : ""}${value.toLocaleString("ko-KR", { maximumFractionDigits: usd ? 6 : 2 })}${usd ? "" : "원"}`;
export default function CashTransfers({
  portfolio,
  accounts,
  disabled,
  onSaved,
  onDirty,
}: {
  portfolio: Portfolio;
  accounts: BrokerageAccount[];
  disabled: boolean;
  onSaved: (value: Portfolio, message: string) => void;
  onDirty: (value: boolean) => void;
}) {
  const [kind, setKind] = useState<CashMovementKind>("deposit");
  const [sourceId, setSourceId] = useState(""),
    [destinationId, setDestinationId] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [fxRate, setFxRate] = useState("");
  const [pending, setPending] = useState<CashTransferInput | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]),
    [historyError, setHistoryError] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyVersion, setHistoryVersion] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!historyOpen) return;
    let live = true;
    void fetch("/api/portfolio/transfers", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const data = await r.json();
        if (live) {
          setEntries(data.transfers);
          setHistoryError(false);
        }
      })
      .catch(() => {
        if (live) setHistoryError(true);
      });
    return () => {
      live = false;
    };
  }, [historyOpen, historyVersion]);
  const dirty = Boolean(
    sourceId || destinationId || amount || note || fxRate || pending || busy,
  );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const source = portfolio.manualAssets.find((a) => a.id === sourceId),
    destination = portfolio.manualAssets.find((a) => a.id === destinationId);
  const primary = kind === "deposit" ? destination : source;
  const usd = primary?.valueUsd != null;
  const label = (asset: ManualAsset) => {
    const account = accounts.find((a) => a.id === asset.accountId);
    return [
      account ? `${account.broker} · ${account.name}` : null,
      asset.name,
      money(asset.valueUsd ?? asset.valueKrw, asset.valueUsd !== null),
    ]
      .filter(Boolean)
      .join(" / ");
  };
  let preview: { source: string; destination: string } | null = null,
    validation = "";
  if (primary && amount && (kind !== "transfer" || destination))
    try {
      preview = transferBalances(
        kind === "deposit"
          ? Number(amount).toFixed(6)
          : String(primary.valueUsd ?? primary.valueKrw),
        kind === "withdrawal"
          ? "0"
          : String(destination!.valueUsd ?? destination!.valueKrw),
        Number(amount),
        usd ? "USD" : "KRW",
      );
      if (
        kind === "deposit" &&
        usd &&
        fxRate &&
        (!Number.isFinite(Number(fxRate)) ||
          Number(fxRate) < 100 ||
          Number(fxRate) > 100000 ||
          Number(Number(fxRate).toFixed(6)) !== Number(fxRate))
      )
        throw Error(
          "매입 환율은 100~100,000원 사이, 소수점 6자리까지 입력하세요.",
        );
    } catch (e) {
      preview = null;
      validation = e instanceof Error ? e.message : "금액을 확인하세요.";
    }
  function clear() {
    setPending(null);
    setSourceId("");
    setDestinationId("");
    setAmount("");
    setNote("");
    setFxRate("");
    setError("");
  }
  function chooseKind(next: CashMovementKind) {
    if (next === kind) return;
    if (
      dirty &&
      !window.confirm("입력한 내용을 지우고 입출금 종류를 바꿀까요?")
    )
      return;
    clear();
    setKind(next);
  }
  async function confirm() {
    if (!pending || inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/portfolio/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const data = await r.json();
      if (!r.ok || !data.portfolio) {
        if (r.status === 409) {
          const fresh = await fetch("/api/portfolio", { cache: "no-store" });
          const latest = await fresh.json();
          if (fresh.ok && latest.portfolio) {
            clear();
            onSaved(
              latest.portfolio,
              "최신 잔액을 불러왔습니다. 최근 내역을 확인한 뒤 다시 입력하세요.",
            );
            setHistoryVersion((v) => v + 1);
          }
        }
        throw Error(data.message || "입출금을 반영하지 못했습니다.");
      }
      const message = `${money(pending.amount, usd)} ${names[pending.kind ?? "transfer"]}을 기록했습니다. ${pending.kind === "transfer" ? "두 현금 잔액을 함께 변경했습니다." : "현금 잔고와 입출금 기록에 함께 반영했습니다."}`;
      clear();
      setHistoryVersion((v) => v + 1);
      onSaved(data.portfolio, message);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "연결을 확인한 뒤 같은 요청으로 재시도하세요.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <details className={styles.section} id="edit-cash-movements">
      <summary className={styles.heading}>
        <span className={styles.headingIcon}>
          <ArrowLeftRight size={21} />
        </span>
        <span>
          <strong>입출금·이체</strong>
          <small>외부 투자금과 계좌 간 현금 이동</small>
        </span>
        <ChevronDown size={17} />
      </summary>
      <p>
        실제 송금 후 앱의 잔고를 반영하세요. 등록한 현금·RP 자산에서 선택합니다.
      </p>
      <div className={styles.kindTabs} role="group" aria-label="현금 이동 종류">
        {(
          [
            ["deposit", ArrowDownLeft],
            ["withdrawal", ArrowUpRight],
            ["transfer", ArrowLeftRight],
          ] as const
        ).map(([value, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            disabled={busy || !!pending || disabled}
            onClick={() => chooseKind(value)}
          >
            <Icon size={16} />
            {names[value]}
          </button>
        ))}
      </div>
      {disabled && (
        <p role="status">
          자산 변경 내용을 먼저 저장하거나 취소하면 입출금을 입력할 수 있습니다.
        </p>
      )}
      {!portfolio.manualAssets.length ? (
        <p>현금 자산을 등록하고 저장한 뒤 입출금을 입력하세요.</p>
      ) : (
        <>
          <fieldset
            disabled={disabled || busy || !!pending}
            className={styles.form}
          >
            {kind !== "deposit" && (
              <label>
                출금할 현금 자산
                <select
                  aria-label="출금할 현금 자산"
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value);
                    setDestinationId("");
                    setError("");
                  }}
                >
                  <option value="">출금 자산 선택</option>
                  {portfolio.manualAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {label(a)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind !== "withdrawal" && (
              <label>
                입금할 현금 자산
                <select
                  aria-label="입금할 현금 자산"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                  disabled={kind === "transfer" && !source}
                >
                  <option value="">입금 자산 선택</option>
                  {portfolio.manualAssets
                    .filter(
                      (a) =>
                        kind === "deposit" ||
                        (a.id !== sourceId &&
                          source &&
                          (a.valueUsd === null) === (source.valueUsd === null)),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {label(a)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              {names[kind]} 금액 ·{" "}
              {primary ? (usd ? "USD" : "KRW") : "자산 선택 후 입력"}
              <NumberInput
                aria-label={`${names[kind]} 금액`}
                value={amount}
                onValueChange={setAmount}
                min="0"
                step={usd ? "0.01" : "1"}
                placeholder="금액 입력"
              />
            </label>
            <label>
              메모 · 선택
              <input
                aria-label={`${names[kind]} 메모`}
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  kind === "deposit"
                    ? "예: 월급에서 투자금 입금"
                    : "예: 현금 이동"
                }
              />
            </label>
            {kind === "deposit" && usd && (
              <label>
                입금 달러의 매입 환율 · 선택
                <NumberInput
                  value={fxRate}
                  onValueChange={setFxRate}
                  min="100"
                  max="100000"
                  step="any"
                  placeholder="모르면 비워두세요"
                />
                <small>환율 손익의 원가에 사용합니다.</small>
              </label>
            )}
          </fieldset>
          {validation && (
            <p role="alert" className={styles.error}>
              {validation}
            </p>
          )}
          {preview && primary && (
            <div className={styles.preview}>
              <strong>
                {pending
                  ? `${names[kind]} · ${money(Number(amount), usd)}`
                  : "반영 후 예상 잔액"}
              </strong>
              <dl>
                {source && kind !== "deposit" && (
                  <div>
                    <dt>{source.name}</dt>
                    <dd>{money(Number(preview.source), usd)}</dd>
                  </div>
                )}
                {destination && kind !== "withdrawal" && (
                  <div>
                    <dt>{destination.name}</dt>
                    <dd>{money(Number(preview.destination), usd)}</dd>
                  </div>
                )}
              </dl>
              <small>
                {kind === "transfer"
                  ? "총자산은 유지하며 외부 입출금으로 기록하지 않습니다."
                  : "현금 잔고와 자산 기록의 입출금 내역을 함께 반영합니다. 이미 기록한 같은 입출금은 중복 등록하지 마세요."}
              </small>
              {kind !== "transfer" && (
                <small>
                  등록 시점 기준으로 반영합니다.
                  {usd ? " 입출금 기록은 현재 환율로 원화 환산합니다." : ""}
                </small>
              )}
              {kind === "transfer" &&
                usd &&
                (source?.averageFxRate == null ||
                  ((destination?.valueUsd ?? 0) > 0 &&
                    destination?.averageFxRate == null)) && (
                  <small>
                    환전 원가를 모르는 자금이 섞여 입금 자산의 환율 손익은
                    미확인으로 표시됩니다.
                  </small>
                )}
              {kind === "deposit" && usd && !fxRate && (
                <small>
                  매입 환율을 모르면 이 달러 자산의 환율 손익은 미확인으로
                  표시될 수 있습니다.
                </small>
              )}
            </div>
          )}
          <div className={styles.actions}>
            {pending ? (
              <>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => void confirm()}
                >
                  {busy
                    ? "반영 중…"
                    : error
                      ? "같은 요청 재시도"
                      : `${names[kind]} 확정`}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setError("");
                  }}
                >
                  입력으로 돌아가기
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={disabled || !preview || busy}
                  onClick={() => {
                    setError("");
                    setPending({
                      id: crypto.randomUUID(),
                      kind,
                      sourceId: kind === "deposit" ? null : sourceId,
                      destinationId:
                        kind === "withdrawal" ? null : destinationId,
                      amount: Number(amount),
                      note,
                      fxRate:
                        kind === "deposit" && usd && fxRate
                          ? Number(fxRate)
                          : null,
                      expectedRevision: portfolio.cashRevision ?? 0,
                    });
                  }}
                >
                  {names[kind]} 내용 확인
                </button>
                {dirty && (
                  <button type="button" onClick={clear}>
                    입력 취소
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <details
        className={styles.history}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
      >
        <summary>최근 입출금·이체 기록</summary>
        {historyError ? (
          <p role="status">
            내역을 불러오지 못했습니다.{" "}
            <button
              type="button"
              onClick={() => setHistoryVersion((v) => v + 1)}
            >
              다시 불러오기
            </button>
          </p>
        ) : entries.length ? (
          entries.map((entry) => (
            <article key={entry.id}>
              <span className={styles.historyKind}>
                {names[entry.kind ?? "transfer"]}
              </span>
              <strong>
                {money(Number(entry.amount), entry.currency === "USD")}
              </strong>
              <span>
                {entry.source_name} → {entry.destination_name}
              </span>
              <small>
                {new Date(entry.created_at).toLocaleString("ko-KR")}
                {entry.note ? ` · ${entry.note}` : ""}
              </small>
            </article>
          ))
        ) : (
          <p>아직 기록이 없습니다.</p>
        )}
      </details>
    </details>
  );
}
