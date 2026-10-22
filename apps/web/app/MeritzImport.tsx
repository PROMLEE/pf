"use client";
import { useEffect, useState } from "react";
import type { BrokerageAccount } from "./accounts-model";
import type { Holding } from "./holdings";
import type { ManualAsset, Portfolio } from "./portfolio-model";
import styles from "./MeritzImport.module.css";
import {
  meritzSyncSettingsEvent,
  meritzSyncStatusEvent,
  type MeritzSyncStatus,
} from "./use-meritz-sync";
export default function MeritzImport({
  accounts,
  disabled,
  onDirty,
}: {
  accounts: BrokerageAccount[];
  disabled: boolean;
  onApplied: (result: {
    holdings: Holding[];
    portfolio: Portfolio;
    count: number;
  }) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [sync, setSync] = useState<MeritzSyncStatus | null>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cash, setCash] = useState<ManualAsset[]>([]);
  const [krwAssetId, setKrwAssetId] = useState("");
  const [usdAssetId, setUsdAssetId] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/accounts/meritz/sync", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => {
        if (active) setSync(r);
      })
      .catch(() => {});
    const receive = (event: Event) => {
      if (active) setSync((event as CustomEvent<MeritzSyncStatus>).detail);
    };
    window.addEventListener(meritzSyncStatusEvent, receive);
    return () => {
      active = false;
      window.removeEventListener(meritzSyncStatusEvent, receive);
    };
  }, []);
  useEffect(() => {
    onDirty(open || busy);
    return () => onDirty(false);
  }, [open, busy, onDirty]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/portfolio", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok || !data.portfolio)
        throw Error("포트폴리오를 먼저 만들어 주세요.");
      setCash(data.portfolio.manualAssets);
      const eligible = accounts.filter((a) => a.broker.includes("메리츠"));
      setAccountId(eligible.length === 1 ? eligible[0].id : "");
      setKrwAssetId("");
      setUsdAssetId("");
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function configure(body: object) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/accounts/meritz/sync", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message || "연결하지 못했습니다.");
      setSync(data);
      setOpen(false);
      window.dispatchEvent(new Event(meritzSyncSettingsEvent));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!sync?.available) return null;
  return (
    <section className={styles.importer} aria-label="메리츠 계좌 동기화">
      <div className={styles.heading}>
        <div>
          <strong>메리츠 {sync.accountName || "계좌 연결"}</strong>
          <p>
            접속 시 한 번, 필요할 때 동기화 버튼으로 잔고를 바로 반영합니다.
          </p>
        </div>
        {(!sync.configured || !sync.enabled) && !open && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() =>
              sync.configured ? void configure({ enabled: true }) : void start()
            }
          >
            {busy ? "연결 중" : "연결하기"}
          </button>
        )}
      </div>
      {sync.configured && (
        <details className={styles.connection}>
          <summary>연결 설정</summary>
          <p>
            주식 수량·평균 매입단가와 원화·달러 예수금을 실제 잔고로 맞춥니다.
            다른 계좌와 가상자산은 유지합니다.
          </p>
          <button
            type="button"
            disabled={disabled || busy || open}
            onClick={() => void configure({ action: "disconnect" })}
          >
            연결 해제
          </button>
        </details>
      )}
      {(error || sync.error) && (
        <p role="alert" className={styles.error}>
          {error || sync.error}
        </p>
      )}
      {open && (
        <div className={styles.form}>
          <label>
            Super365 계좌
            <select
              value={accountId}
              disabled={busy}
              onChange={(e) => {
                setAccountId(e.target.value);
                setKrwAssetId("");
                setUsdAssetId("");
              }}
            >
              <option value="">계좌 선택</option>
              {accounts
                .filter((a) => a.broker.includes("메리츠"))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <div className={styles.fields}>
            {(
              [
                ["KRW", krwAssetId, setKrwAssetId],
                ["USD", usdAssetId, setUsdAssetId],
              ] as const
            ).map(([currency, id, setId]) => (
              <label key={currency}>
                {currency === "KRW" ? "원화 예수금" : "달러 예수금"}
                <select
                  value={id}
                  disabled={busy || !accountId}
                  onChange={(e) => setId(e.target.value)}
                >
                  <option value="">기존 현금 자산 선택</option>
                  {cash
                    .filter(
                      (c) =>
                        (currency === "USD") === (c.valueUsd !== null) &&
                        (!c.accountId || c.accountId === accountId),
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <p>
            연결하면 변경 내용을 별도 확인 없이 반영합니다. 현금은 계좌에 등록한
            기존 자산을 선택하세요.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || !accountId || !krwAssetId || !usdAssetId}
              onClick={() =>
                void configure({
                  action: "configure",
                  accountId,
                  krwAssetId,
                  usdAssetId,
                })
              }
            >
              {busy ? "연결 중" : "연결하고 동기화"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
