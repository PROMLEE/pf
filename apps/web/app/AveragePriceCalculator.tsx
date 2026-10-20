"use client";
import { useId, useState } from "react";
import NumberInput from "./NumberInput";
import { calculateAveragePrice, type AveragePriceMode } from "./average-price";
import styles from "./AveragePriceCalculator.module.css";

type Initial = {
  quantity?: number | null;
  averagePrice?: number | null;
  buyPrice?: number | null;
  currency?: "KRW" | "USD";
  fractional?: boolean;
};
const raw = (n: number | null | undefined) =>
  n != null && n > 0 ? String(n) : "";
export default function AveragePriceCalculator({
  initial = {},
}: {
  initial?: Initial;
}) {
  const id = useId();
  const [quantity, setQuantity] = useState(raw(initial.quantity));
  const [averagePrice, setAveragePrice] = useState(raw(initial.averagePrice));
  const [buyPrice, setBuyPrice] = useState(raw(initial.buyPrice));
  const [currency, setCurrency] = useState(initial.currency ?? "KRW");
  const [fractional, setFractional] = useState(initial.fractional ?? false);
  const [mode, setMode] = useState<AveragePriceMode>("quantity");
  const [amounts, setAmounts] = useState({
    quantity: "",
    budget: "",
    target: "",
  });
  const amount = amounts[mode];
  const ready = [quantity, averagePrice, buyPrice, amount].every(
    (v) => v.trim() !== "",
  );
  let result: ReturnType<typeof calculateAveragePrice> | null = null,
    error = "";
  if (ready) {
    try {
      result = calculateAveragePrice({
        quantity: Number(quantity),
        averagePrice: Number(averagePrice),
        buyPrice: Number(buyPrice),
        amount: Number(amount),
        mode,
        fractional,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : "입력값을 확인하세요.";
    }
  }
  const money = (n: number, unitPrice = false) =>
    `${currency === "USD" ? "$" : ""}${n.toLocaleString("ko-KR", { maximumFractionDigits: unitPrice ? (fractional ? 8 : currency === "USD" ? 4 : 2) : currency === "USD" ? 2 : 0 })}${currency === "KRW" ? "원" : ""}`;
  const qty = (n: number) =>
    n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
  function reset() {
    setQuantity(raw(initial.quantity));
    setAveragePrice(raw(initial.averagePrice));
    setBuyPrice(raw(initial.buyPrice));
    setCurrency(initial.currency ?? "KRW");
    setFractional(initial.fractional ?? false);
    setAmounts({ quantity: "", budget: "", target: "" });
  }
  return (
    <div className={styles.calculator}>
      <div className={styles.settings}>
        <label>
          계산 통화
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "KRW" | "USD")}
          >
            <option value="KRW">원화 · KRW</option>
            <option value="USD">달러 · USD</option>
          </select>
        </label>
        <label>
          거래 단위
          <select
            value={fractional ? "fractional" : "whole"}
            onChange={(e) => setFractional(e.target.value === "fractional")}
          >
            <option value="whole">주식 · 1주</option>
            <option value="fractional">코인·소수점 거래 · 8자리</option>
          </select>
        </label>
      </div>
      <div className={styles.inputs}>
        <fieldset>
          <legend>현재 보유분</legend>
          <label>
            총보유 수량
            <NumberInput
              min="0"
              step="any"
              value={quantity}
              onValueChange={setQuantity}
              placeholder="현재 전체 수량"
            />
          </label>
          <label>
            평균 매입단가 · {currency}
            <NumberInput
              min="0"
              step="any"
              value={averagePrice}
              onValueChange={setAveragePrice}
              placeholder="1주·1개당 평균 가격"
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>추가 매수</legend>
          <label>
            추가 매수 단가 · {currency}
            <NumberInput
              min="0"
              step="any"
              value={buyPrice}
              onValueChange={setBuyPrice}
              placeholder="1주·1개당 매수 가격"
            />
          </label>
          <div className={styles.modes} role="group" aria-label="계산 방식">
            {(
              [
                ["quantity", "수량으로"],
                ["budget", "금액으로"],
                ["target", "목표 평단가로"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label>
            {mode === "quantity"
              ? "추가 매수 수량"
              : mode === "budget"
                ? `사용할 금액 · ${currency}`
                : `원하는 평균 매입단가 · ${currency}`}
            <NumberInput
              min="0"
              step={mode === "quantity" && !fractional ? "1" : "any"}
              value={amount}
              onValueChange={(v) =>
                setAmounts((current) => ({ ...current, [mode]: v }))
              }
              placeholder={
                mode === "quantity"
                  ? "추가로 살 수량"
                  : mode === "budget"
                    ? "이번에 사용할 예산"
                    : "매수 후 목표 평단가"
              }
              aria-describedby={`${id}-help`}
            />
          </label>
          <p id={`${id}-help`} className={styles.hint}>
            {mode === "target"
              ? "목표에 도달하거나 넘어서는 최소 수량을 계산합니다."
              : mode === "budget"
                ? "선택한 거래 단위 안에서 예산을 넘지 않게 계산합니다."
                : "기존 평단가보다 낮게 사면 물타기, 높게 사면 불타기로 계산됩니다."}
          </p>
        </fieldset>
      </div>
      <section
        className={styles.result}
        aria-label="추가 매수 계산 결과"
        aria-live="polite"
        aria-atomic="true"
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : result ? (
          <>
            <div className={styles.resultHead}>
              <span>
                {result.additionalQuantity === 0
                  ? "매수 가능 수량 없음"
                  : Number(buyPrice) < Number(averagePrice)
                    ? "물타기 후 예상 평단가"
                    : Number(buyPrice) > Number(averagePrice)
                      ? "불타기 후 예상 평단가"
                      : "추가 매수 후 예상 평단가"}
              </span>
              <strong>{money(result.averagePrice, true)}</strong>
              <p>
                기존 {money(Number(averagePrice), true)}{" "}
                <span>
                  → {result.changePercent > 0 ? "+" : ""}
                  {result.changePercent.toFixed(2)}%
                </span>
              </p>
            </div>
            <dl>
              <div>
                <dt>추가 매수 수량</dt>
                <dd>
                  {qty(result.additionalQuantity)}
                  {fractional ? "" : "주"}
                </dd>
              </div>
              <div>
                <dt>필요 자금</dt>
                <dd>{money(result.additionalCost)}</dd>
              </div>
              <div>
                <dt>매수 후 총수량</dt>
                <dd>
                  {qty(result.totalQuantity)}
                  {fractional ? "" : "주"}
                </dd>
              </div>
              <div>
                <dt>매수 후 총매입금액</dt>
                <dd>{money(result.totalCost)}</dd>
              </div>
              {result.remainingBudget !== null && (
                <div>
                  <dt>남는 예산</dt>
                  <dd>{money(result.remainingBudget)}</dd>
                </div>
              )}
            </dl>
            {result.additionalQuantity === 0 && (
              <p className={styles.hint}>
                입력한 예산으로는 선택한 거래 단위만큼 살 수 없습니다.
              </p>
            )}
          </>
        ) : (
          <p className={styles.hint}>
            보유 수량·평단가와 추가 매수 조건을 입력하면 결과가 표시됩니다.
          </p>
        )}
      </section>
      <div className={styles.footer}>
        <p>
          계산은 입력한 통화 기준입니다. 통화 선택은 환전 계산이 아니며
          수수료·세금은 포함하지 않습니다. 보유 자산에는 반영되지 않습니다.
        </p>
        <button type="button" onClick={reset}>
          초기화
        </button>
      </div>
    </div>
  );
}
