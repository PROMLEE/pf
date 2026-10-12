"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Holding } from "./holdings";
import NumberInput from "./NumberInput";
import { calculatePositionTrade, type TradeSide } from "./position-trade";
import styles from "./HoldingTradeEditor.module.css";

export default function HoldingTradeEditor({
  holding,
  onSaved,
  onCancel,
  onDirect,
  onDirty,
  onBusy,
}: {
  holding: Holding;
  onSaved: (holdings: Holding[], message: string) => void;
  onCancel: () => void;
  onDirect: () => void;
  onDirty: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [base, setBase] = useState(holding);
  const [side, setSide] = useState<TradeSide>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = Boolean(quantity || price || fee);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!base.revision && holding.revision) setBase(holding);
  }, [base.revision, holding]);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  const currency = base.market === "US" ? "USD" : "원";
  const money = (value: number | null) =>
    value === null
      ? "미입력"
      : `${base.market === "US" ? "$" : ""}${value.toLocaleString(base.market === "US" ? "en-US" : "ko-KR", { maximumFractionDigits: 6 })}${base.market === "US" ? "" : "원"}`;
  const trade = {
    side,
    quantity: Number(quantity),
    price: Number(price),
    fee: fee === "" ? 0 : Number(fee),
  };
  let preview: ReturnType<typeof calculatePositionTrade> | null = null;
  let validation = "";
  if (quantity && price) {
    try {
      preview = calculatePositionTrade(base, trade);
    } catch (error) {
      validation =
        error instanceof Error ? error.message : "입력을 확인해 주세요.";
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/holdings/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: base.id,
          trade: {
            ...trade,
            expected: {
              quantity: base.quantity,
              averageCost: base.averageCost,
              market: base.market,
              symbol: base.symbol,
              accountId: base.accountId,
              revision: base.revision,
            },
          },
        }),
      });
      const result = await res.json();
      if (!res.ok)
        throw new Error(result.message || "거래를 반영하지 못했습니다.");
      onSaved(
        result.holdings,
        result.position.quantity === 0
          ? `${base.name} 전량 매도 반영 완료`
          : `${base.name} ${side === "buy" ? "추가 매수" : "매도"} 반영 완료 · ${result.position.quantity.toLocaleString()}주 · 평균 매입단가 ${money(result.position.averageCost)}`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "거래 반영 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.editor}
      onSubmit={submit}
      aria-label={`${base.name} 매수·매도 반영`}
    >
      <header>
        <strong>{base.name}</strong>
        <small>
          {base.broker} · {base.account}
        </small>
      </header>
      <fieldset disabled={busy}>
        <div className={styles.tabs} role="group" aria-label="거래 유형">
          <button
            type="button"
            aria-pressed={side === "buy"}
            onClick={() => setSide("buy")}
          >
            추가 매수
          </button>
          <button
            type="button"
            aria-pressed={side === "sell"}
            onClick={() => setSide("sell")}
          >
            매도
          </button>
        </div>
        <div className={styles.inputs}>
          <label>
            {side === "buy" ? "추가 매수 수량 · 주" : "매도 수량 · 주"}
            <NumberInput
              value={quantity}
              onValueChange={setQuantity}
              min="0.000001"
              step="0.000001"
              required
            />
          </label>
          <label>
            {side === "buy" ? "주당 매수 단가" : "주당 매도 단가"} · {currency}
            <NumberInput
              value={price}
              onValueChange={setPrice}
              min="0.000001"
              step="any"
              required
            />
          </label>
        </div>
        <details className={styles.fee}>
          <summary>수수료·거래 비용 입력 (선택)</summary>
          <label>
            거래 비용 · {currency}
            <NumberInput
              value={fee}
              onValueChange={setFee}
              min="0"
              step="any"
              placeholder="0"
            />
          </label>
        </details>
      </fieldset>
      <div className={styles.preview} role="status">
        <div>
          <span>보유 수량</span>
          <strong>
            {base.quantity.toLocaleString()}주 →{" "}
            {preview ? `${preview.quantity.toLocaleString()}주` : "—"}
          </strong>
        </div>
        <div>
          <span>평균 매입단가</span>
          <strong>
            {money(base.averageCost)} →{" "}
            {preview && preview.quantity > 0 ? money(preview.averageCost) : "—"}
          </strong>
        </div>
        {preview && (
          <div>
            <span>{side === "buy" ? "매수 총액" : "매도 수령액"}</span>
            <strong>
              {money(preview.gross + (side === "buy" ? trade.fee : -trade.fee))}
            </strong>
          </div>
        )}
        {side === "sell" && preview?.realisedGain !== null && preview && (
          <div>
            <span>이번 매도 손익</span>
            <strong>{money(preview.realisedGain)}</strong>
          </div>
        )}
        {side === "sell" && preview && preview.quantity > 0 && (
          <small>일부 매도 후 남은 수량의 평균 매입단가는 유지됩니다.</small>
        )}
        {preview?.quantity === 0 && (
          <small>
            전량 매도를 반영하면 이 계좌의 보유 종목 목록에서 제거됩니다.
          </small>
        )}
      </div>
      {(validation || error) && (
        <p role="alert" className={styles.error}>
          {error || validation}
        </p>
      )}
      {dirty && (
        <p className={styles.dirty} role="status">
          미저장 · {side === "buy" ? "추가 매수" : "매도"} 입력
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onCancel}>
          취소
        </button>
        <button type="submit" disabled={!preview || busy || !base.revision}>
          {busy
            ? "반영 중…"
            : side === "buy"
              ? "매수분 반영"
              : preview?.quantity === 0
                ? "전량 매도 반영"
                : "매도분 반영"}
        </button>
      </div>
      <button
        type="button"
        className={styles.direct}
        disabled={busy}
        onClick={() => {
          if (
            !dirty ||
            window.confirm(
              "입력한 거래 내용을 버리고 전체 수량 직접 수정으로 바꿀까요?",
            )
          )
            onDirect();
        }}
      >
        전체 수량·평단 직접 수정
      </button>
    </form>
  );
}
