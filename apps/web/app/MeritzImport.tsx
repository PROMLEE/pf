"use client";
import { useEffect, useState } from "react";
import { Download, RefreshCw, Check } from "lucide-react";
import type { BrokerageAccount } from "./accounts-model";
import type { Holding } from "./holdings";
import type { ManualAsset, Portfolio } from "./portfolio-model";
import type { MeritzPreview } from "./meritz-model";
import AssetIcon from "./AssetIcon";
import styles from "./MeritzImport.module.css";
const value = (n: number | null, currency: string) =>
  n === null
    ? "미등록"
    : `${currency === "USD" ? "$" : ""}${n.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}${currency === "KRW" ? "원" : ""}`;
async function read<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw Error(data.message || "잔고를 처리하지 못했습니다.");
  return data;
}
export default function MeritzImport({
  accounts,
  disabled,
  onApplied,
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
  const [available, setAvailable] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [accountId, setAccountId] = useState(""),
    [cash, setCash] = useState<ManualAsset[]>([]),
    [krwAssetId, setKrwAssetId] = useState("skip"),
    [usdAssetId, setUsdAssetId] = useState("skip");
  const [preview, setPreview] = useState<MeritzPreview | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/accounts/meritz", { cache: "no-store" })
      .then((r) => r.json())
      .then((r) => {
        if (active) setAvailable(r.available === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    onDirty(!!preview || busy);
    return () => onDirty(false);
  }, [preview, busy, onDirty]);
  const eligible = accounts.filter((a) => a.broker.includes("메리츠"));
  async function start() {
    setError("");
    setBusy(true);
    try {
      const data = await read<{ portfolio: Portfolio | null }>(
        await fetch("/api/portfolio", { cache: "no-store" }),
      );
      if (!data.portfolio)
        throw Error("목표 설계에서 포트폴리오를 먼저 만들어 주세요.");
      setCash(data.portfolio.manualAssets);
      setAccountId(eligible.length === 1 ? eligible[0].id : "");
      setKrwAssetId("skip");
      setUsdAssetId("skip");
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    setError("");
    setBusy(true);
    try {
      const data = await read<MeritzPreview>(
        await fetch("/api/accounts/meritz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            accountId,
            krwAssetId,
            usdAssetId,
          }),
        }),
      );
      setPreview(data);
      setSelected(data.changes.map((c) => c.key));
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview || !confirmed) return;
    setError("");
    setBusy(true);
    try {
      const data = await read<{
        holdings: Holding[];
        portfolio: Portfolio;
        count: number;
      }>(
        await fetch("/api/accounts/meritz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "apply",
            token: preview.token,
            selected,
          }),
        }),
      );
      setPreview(null);
      setOpen(false);
      onApplied(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function cashSelect(
    currency: "KRW" | "USD",
    id: string,
    setId: (id: string) => void,
  ) {
    const matches = cash.filter(
      (c) =>
        (currency === "USD") === (c.valueUsd !== null) &&
        (!c.accountId || c.accountId === accountId),
    );
    return (
      <label>
        {currency === "KRW" ? "원화 현금" : "달러 현금"}
        <select
          value={id}
          onChange={(e) => setId(e.target.value)}
          disabled={busy || !accountId}
        >
          <option value="skip">이번에는 반영하지 않음</option>
          {matches.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.accountId ? "" : " · 계좌 미지정"}
            </option>
          ))}
          {!matches.some((c) => c.accountId === accountId) && (
            <option value="new">이 계좌의 현금 자산 새로 만들기</option>
          )}
        </select>
      </label>
    );
  }
  if (!available) return null;
  return (
    <section className={styles.importer} aria-label="메리츠 잔고 불러오기">
      <div className={styles.heading}>
        <div>
          <strong>메리츠 계좌 연결</strong>
          <p>실제 잔고와 비교한 뒤 선택한 변경만 반영합니다.</p>
        </div>
        {!open && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => void start()}
          >
            <Download size={16} />
            {busy ? "준비 중" : "잔고 불러오기"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {open && !preview && (
        <div className={styles.form}>
          <label>
            반영할 Super365 계좌
            <select
              value={accountId}
              disabled={busy}
              onChange={(e) => {
                setAccountId(e.target.value);
                setKrwAssetId("skip");
                setUsdAssetId("skip");
              }}
            >
              <option value="">등록된 메리츠 계좌 선택</option>
              {eligible.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {!eligible.length && (
            <p>‘계좌 추가’에서 메리츠증권 계좌를 먼저 등록해 주세요.</p>
          )}
          <div className={styles.fields}>
            {cashSelect("KRW", krwAssetId, setKrwAssetId)}
            {cashSelect("USD", usdAssetId, setUsdAssetId)}
          </div>
          <p className={styles.note}>
            API를 신청한 계좌와 같은 계좌를 선택하세요. 현금은 거래 차액을
            더하지 않고 조회된 잔고로 바꿉니다. 다른 곳에 이미 등록한 현금은
            기존 자산을 선택해 중복을 방지하세요.
          </p>
          <details>
            <summary>현금 집계 기준</summary>
            <p>
              원화는 D+2 예수금, 달러는 추정 외화 예수금입니다. 매매 결제
              예정액이 포함될 수 있으며 지금 출금 가능한 금액과 다를 수
              있습니다. 달러 외 통화는 반영하지 않습니다.
            </p>
          </details>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={!accountId || busy}
              onClick={() => void load()}
            >
              <RefreshCw size={15} />
              {busy ? "잔고 조회 중" : "변경 내용 확인"}
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
      {preview && (
        <div className={styles.review}>
          <div>
            <h3>
              {preview.accountName} · 변경 {preview.changes.length}건
            </h3>
            <p>
              동일한 항목 {preview.unchanged}건 ·{" "}
              {new Date(preview.fetchedAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              조회 · 5분 내 반영
            </p>
          </div>
          <p className={styles.note}>
            수량·평균 매입단가와 선택한 현금만 바뀝니다. 포트 배정과 기존
            매입환율은 유지하며, 신규 해외 종목의 매입환율은 직접 입력해 주세요.
            진행 중인 리밸런싱 계획의 거래 완료 표시는 별도로 확인하세요.
          </p>
          {preview.warnings.length > 0 && (
            <details open>
              <summary>직접 확인할 항목 {preview.warnings.length}건</summary>
              <ul>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className={styles.rows}>
            {preview.changes.map((c) => (
              <label className={styles.row} key={c.key}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, c.key]
                        : ids.filter((id) => id !== c.key),
                    );
                    setConfirmed(false);
                  }}
                />
                {c.position && (
                  <AssetIcon
                    kind="stock"
                    market={c.position.market}
                    symbol={c.position.symbol}
                    name={c.name}
                  />
                )}
                <span>
                  <strong>{c.name}</strong>
                  {c.kind === "stock" ? (
                    <>
                      <span>
                        수량{" "}
                        {c.before === null
                          ? "미등록"
                          : c.before.toLocaleString("ko-KR", {
                              maximumFractionDigits: 6,
                            })}{" "}
                        →{" "}
                        {c.after.toLocaleString("ko-KR", {
                          maximumFractionDigits: 6,
                        })}
                        주
                      </span>
                      <small>
                        주당 평균 매입단가{" "}
                        {value(c.beforeCost ?? null, c.currency)} →{" "}
                        {value(c.position!.averageCost, c.currency)}
                      </small>
                    </>
                  ) : (
                    <span>
                      잔고 {value(c.before, c.currency)} →{" "}
                      {value(c.after, c.currency)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {preview.changes.length > 0 && (
            <label className={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>계좌와 선택한 변경 내용을 확인했습니다.</span>
            </label>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || !selected.length || !confirmed}
              onClick={() => void apply()}
            >
              <Check size={16} />
              {busy ? "반영 중" : `선택한 ${selected.length}건 반영`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setSelected([]);
                setConfirmed(false);
              }}
            >
              다시 선택
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setOpen(false);
              }}
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
