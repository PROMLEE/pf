"use client";
import { useEffect, useRef, useState } from "react";
import type { Portfolio, ManualAsset } from "./portfolio-model";
import type { BrokerageAccount } from "./accounts-model";
import { transferBalances, type CashTransferInput } from "./cash-transfer";
import NumberInput from "./NumberInput";
import styles from "./CashTransfers.module.css";
type Entry = {
  id: string;
  source_name: string;
  destination_name: string;
  currency: "KRW" | "USD";
  amount: string;
  note: string;
  created_at: string;
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
  const [sourceId, setSourceId] = useState(""),
    [destinationId, setDestinationId] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState("");
  const [pending, setPending] = useState<CashTransferInput | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]),
    [historyError, setHistoryError] = useState(false),
    [historyVersion, setHistoryVersion] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
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
  }, [historyVersion]);
  useEffect(() => {
    onDirty(Boolean(amount || note || pending || busy));
    return () => onDirty(false);
  }, [amount, note, pending, busy, onDirty]);
  const source = portfolio.manualAssets.find((a) => a.id === sourceId),
    destination = portfolio.manualAssets.find((a) => a.id === destinationId);
  const usd = source?.valueUsd !== null;
  const label = (asset: ManualAsset) => {
    const account = accounts.find((a) => a.id === asset.accountId);
    return [
      account ? `${account.broker} · ${account.name}` : "계좌 미연결",
      asset.name,
      money(asset.valueUsd ?? asset.valueKrw, asset.valueUsd !== null),
    ].join(" / ");
  };
  let preview: { source: string; destination: string } | null = null,
    validation = "";
  if (source && destination && amount)
    try {
      preview = transferBalances(
        String(source.valueUsd ?? source.valueKrw),
        String(destination.valueUsd ?? destination.valueKrw),
        Number(amount),
        usd ? "USD" : "KRW",
      );
    } catch (e) {
      validation = e instanceof Error ? e.message : "금액을 확인해 주세요.";
    }
  function clear() {
    setPending(null);
    setAmount("");
    setNote("");
    setError("");
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
              "최신 잔액을 불러왔습니다. 이체 내역을 확인한 뒤 다시 입력하세요.",
            );
            setHistoryVersion((v) => v + 1);
          }
        }
        throw Error(data.message || "이체를 반영하지 못했습니다.");
      }
      clear();
      setHistoryVersion((v) => v + 1);
      onSaved(
        data.portfolio,
        `${money(pending.amount, usd)} 이체를 기록했습니다. 출금·입금 잔액을 함께 반영했습니다.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "연결을 확인한 뒤 같은 이체로 재시도하세요.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  return (
    <section className={styles.section} aria-labelledby="cash-transfer-title">
      <div className={styles.heading}>
        <h2 id="cash-transfer-title">현금 이체 기록</h2>
        <span>원화 ↔ 원화 · 달러 ↔ 달러</span>
      </div>
      <p>
        현금·RP로 관리하는 자산을 선택하세요. 앱에 등록한 두 현금 잔액을 함께
        변경합니다. 실제 송금은 증권사·은행에서 직접 진행하세요.
      </p>
      {disabled && (
        <p role="status">
          자산 변경 내용을 먼저 저장하거나 취소하면 이체를 입력할 수 있습니다.
        </p>
      )}
      {portfolio.manualAssets.length < 2 ? (
        <p>출금·입금할 현금 자산을 아래에서 각각 등록하고 저장해 주세요.</p>
      ) : (
        <>
          <fieldset
            disabled={disabled || busy || pending !== null}
            className={styles.form}
          >
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
            <label>
              입금할 현금 자산
              <select
                aria-label="입금할 현금 자산"
                value={destinationId}
                onChange={(e) => setDestinationId(e.target.value)}
                disabled={!source || disabled || busy || pending !== null}
              >
                <option value="">입금 자산 선택</option>
                {portfolio.manualAssets
                  .filter(
                    (a) =>
                      a.id !== sourceId &&
                      source &&
                      (a.valueUsd === null) === (source.valueUsd === null),
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {label(a)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              이체 금액 · {source ? (usd ? "USD" : "KRW") : "통화 선택 후 입력"}
              <NumberInput
                aria-label="이체 금액"
                value={amount}
                onValueChange={setAmount}
                min="0"
                step={usd ? "0.01" : "1"}
                max={usd ? "1000000000000" : "1000000000000000"}
                placeholder="금액 입력"
              />
            </label>
            <label>
              메모 · 선택
              <input
                aria-label="이체 메모"
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 투자금 이동"
              />
            </label>
          </fieldset>
          {validation && <p role="alert">{validation}</p>}
          {source && destination && preview && (
            <div className={styles.preview}>
              <strong>
                {pending ? "이체 내용 확인" : "변경 후 예상 잔액"}
              </strong>
              <span>
                {source.name}: {money(Number(preview.source), usd)}
              </span>
              <span>
                {destination.name}: {money(Number(preview.destination), usd)}
              </span>
              <small>
                전체 자산 금액은 유지됩니다. 포트 배정이 다르면 포트별 비중은
                바뀝니다. 외부 입출금으로 기록하지 않습니다.
              </small>
              {usd &&
                (source.averageFxRate == null ||
                  ((destination.valueUsd ?? 0) > 0 &&
                    destination.averageFxRate == null)) && (
                  <small>
                    환전 원가가 미확인인 자금이 섞여 입금 자산의 환율 손익은
                    미확인으로 표시됩니다.
                  </small>
                )}
            </div>
          )}
          <div className={styles.actions}>
            {pending ? (
              <>
                <button
                  type="button"
                  onClick={() => void confirm()}
                  disabled={disabled || busy}
                >
                  {busy
                    ? "반영 중…"
                    : error
                      ? "같은 이체 재시도"
                      : "이체 기록 확정"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPending(null);
                    setError("");
                  }}
                  disabled={busy}
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
                      sourceId,
                      destinationId,
                      amount: Number(amount),
                      note,
                      expectedRevision: portfolio.cashRevision ?? 0,
                    });
                  }}
                >
                  이체 내용 확인
                </button>
                {Boolean(amount || note) && (
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
      <details className={styles.history}>
        <summary>최근 이체 기록 {entries.length}건</summary>
        {historyError ? (
          <p role="status">
            이체 기록을 불러오지 못했습니다.{" "}
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
          <p>아직 기록된 이체가 없습니다.</p>
        )}
      </details>
    </section>
  );
}
