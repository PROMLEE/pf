"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { Holding } from "./holdings";
import NumberInput from "./NumberInput";
import {
  calculatePositionTrade,
  calculateTradeCash,
  type TradeSide,
} from "./position-trade";
import { validFx, nextStockBasis } from "./fx-gains";
import type { ManualAsset, Portfolio } from "./portfolio-model";
import { publishTradePortfolio } from "./portfolio-cache";
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
  const currentPrice = holding.currentPrice;
  const defaultPrice =
    currentPrice !== null && Number.isFinite(currentPrice) && currentPrice > 0
      ? String(currentPrice)
      : "";
  const [priceOverride, setPriceOverride] = useState<string | null>(null);
  const price = priceOverride ?? defaultPrice;
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cashAssets, setCashAssets] = useState<ManualAsset[]>([]);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState("");
  const [referenceRate, setReferenceRate] = useState<number | null>(null);
  const [fxOverride, setFxOverride] = useState<string | null>(null);
  const [basisInput, setBasisInput] = useState(
    String(holding.averageCostKrw ?? ""),
  );
  const [basisMode, setBasisMode] = useState<"krw" | "fx">("krw");
  const basisValue =
    basisInput === ""
      ? null
      : basisMode === "fx"
        ? Number(basisInput) * (base.averageCost ?? 0)
        : Number(basisInput);
  const basisDirty =
    basisMode === "fx"
      ? Boolean(basisInput)
      : basisInput !== String(base.averageCostKrw ?? "");
  const fxRate =
    fxOverride ?? (referenceRate === null ? "" : String(referenceRate));
  const fxInvalid = base.market === "US" && !validFx(Number(fxRate));
  const [reflectCash, setReflectCash] = useState(true);
  const [cashId, setCashId] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/portfolio", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            "현금 자산을 불러오지 못했습니다. 수정 화면을 다시 열어 주세요.",
          );
        const assets = (
          (payload.portfolio as Portfolio | null)?.manualAssets ?? []
        ).filter(
          (asset) => (base.market === "US") === (asset.valueUsd !== null),
        );
        if (active) {
          setReferenceRate(payload.portfolio?.usdKrw ?? null);
          setCashAssets(assets);
          if (assets.length === 1) setCashId(assets[0].id);
        }
      })
      .catch((error) => {
        if (active) setCashError(error.message);
      })
      .finally(() => {
        if (active) setCashLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base.market]);
  const dirty = Boolean(
    quantity ||
      priceOverride !== null ||
      fee ||
      fxOverride !== null ||
      basisDirty,
  );
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!base.revision && holding.revision) {
      setBase(holding);
      if (!basisDirty) setBasisInput(String(holding.averageCostKrw ?? ""));
    }
  }, [base.revision, holding, basisDirty]);
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
  const selectedCash = cashAssets.find((asset) => asset.id === cashId);
  const cashBalance = selectedCash
    ? (selectedCash.valueUsd ?? selectedCash.valueKrw)
    : null;
  let cashPreview: ReturnType<typeof calculateTradeCash> | null = null;
  let cashValidation = "";
  if (
    reflectCash &&
    !cashLoading &&
    (quantity || priceOverride !== null || fee)
  ) {
    if (cashError) cashValidation = cashError;
    else if (!selectedCash)
      cashValidation = cashAssets.length
        ? "거래에 사용할 현금 자산을 선택해 주세요."
        : `${currency} 현금 자산을 자산 수정에서 먼저 추가해 주세요.`;
    else if (preview && cashBalance !== null) {
      try {
        cashPreview = calculateTradeCash(cashBalance, trade, base.market);
      } catch (error) {
        cashValidation =
          error instanceof Error ? error.message : "현금 잔고를 확인해 주세요.";
      }
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !preview ||
      busy ||
      fxInvalid ||
      basisDirty ||
      (reflectCash && (cashLoading || cashValidation || !selectedCash))
    )
      return;
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
            ...(base.market === "US" ? { fxRate: Number(fxRate) } : {}),
            cash:
              reflectCash && selectedCash
                ? { assetId: selectedCash.id, expectedBalance: cashBalance }
                : null,
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
      if (result.portfolio && selectedCash)
        publishTradePortfolio(result.portfolio, selectedCash.id);
      window.dispatchEvent(new Event("pf-rebalance-run-updated"));
      onSaved(
        result.holdings,
        (result.position.quantity === 0
          ? `${base.name} 전량 매도 반영 완료`
          : `${base.name} ${side === "buy" ? "추가 매수" : "매도"} 반영 완료 · ${result.position.quantity.toLocaleString()}주 · 평균 매입단가 ${money(result.position.averageCost)}`) +
          (result.progressRecorded ? " · 진행 중인 리밸런싱 계획에 반영" : "") +
          (result.cashChange
            ? ` · ${result.cashChange.name} 잔고 ${money(result.cashChange.balance)}`
            : ""),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "거래 반영 실패");
    } finally {
      setBusy(false);
    }
  }
  async function saveBasis() {
    if (
      busy ||
      !base.revision ||
      !basisDirty ||
      (basisValue !== null &&
        (!Number.isFinite(basisValue) ||
          basisValue <= 0 ||
          basisValue >= 1e15)) ||
      (basisMode === "fx" &&
        basisInput &&
        (!validFx(Number(basisInput)) || !base.averageCost))
    )
      return;
    if (
      (quantity || priceOverride !== null || fee || fxOverride !== null) &&
      !confirm(
        "원화 원가를 저장하면 현재 거래 입력이 닫힙니다. 원가를 먼저 저장할까요?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/holdings/basis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: base.id,
          revision: base.revision,
          averageCostKrw:
            basisValue === null ? null : Math.round(basisValue * 1e6) / 1e6,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "원가 저장 실패");
      onSaved(result.holdings, `${base.name} 원화 원가 저장 완료`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "원가 저장 실패");
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
              onValueChange={setPriceOverride}
              min="0.000001"
              step="any"
              required
            />
          </label>
        </div>
        {base.market === "US" && (
          <>
            <label>
              이번 거래 적용 환율 · 1 USD당 원
              <NumberInput
                value={fxRate}
                onValueChange={setFxOverride}
                min="100"
                max="100000"
                step="any"
              />
            </label>
            <details className={styles.fee}>
              <summary>기존 보유분의 환율 손익 원가 설정</summary>
              <label>
                원가 입력 방식
                <select
                  aria-label="원가 입력 방식"
                  value={basisMode}
                  onChange={(event) => {
                    setBasisMode(event.target.value as "krw" | "fx");
                    setBasisInput("");
                  }}
                >
                  <option value="krw">원화 주당 평균 매입단가</option>
                  <option value="fx">평균 매수 환율</option>
                </select>
              </label>
              <label>
                {basisMode === "krw"
                  ? "원화 기준 주당 평균 매입단가 · 원"
                  : "평균 매수 환율 · 1 USD당 원"}
                <NumberInput
                  value={basisInput}
                  onValueChange={setBasisInput}
                  min="0"
                  step="any"
                  placeholder="모르면 비워두세요"
                />
              </label>
              <small>
                기존 {base.quantity.toLocaleString()}주 전체의 원가입니다. 현재
                환율을 과거 원가로 자동 입력하지 않습니다.
              </small>
              {basisValue !== null && Number.isFinite(basisValue) && (
                <small>
                  원화 총매입금액{" "}
                  {Math.round(basisValue * base.quantity).toLocaleString()}원
                </small>
              )}
              <button
                type="button"
                disabled={
                  busy ||
                  !basisDirty ||
                  (basisValue !== null &&
                    (!Number.isFinite(basisValue) ||
                      basisValue <= 0 ||
                      basisValue >= 1e15)) ||
                  (basisMode === "fx" &&
                    basisInput !== "" &&
                    (!validFx(Number(basisInput)) || !base.averageCost))
                }
                onClick={saveBasis}
              >
                원화 원가 저장
              </button>
            </details>
          </>
        )}
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
        <div className={styles.cash}>
          <label className={styles.cashToggle}>
            <input
              type="checkbox"
              checked={reflectCash}
              onChange={(event) => setReflectCash(event.target.checked)}
            />
            현금 잔고에 함께 반영
          </label>
          {reflectCash ? (
            <>
              <label>
                {side === "buy" ? "매수에 사용할" : "매도 대금을 받을"} 현금 ·{" "}
                {currency}
                <select
                  value={cashId}
                  onChange={(event) => setCashId(event.target.value)}
                  disabled={cashLoading}
                >
                  <option value="">
                    {cashLoading ? "현금 자산 불러오는 중…" : "현금 자산 선택"}
                  </option>
                  {cashAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} · {money(asset.valueUsd ?? asset.valueKrw)}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                {side === "buy"
                  ? "매수 금액과 거래 비용을 차감합니다."
                  : "매도 금액에서 거래 비용을 뺀 금액을 더합니다."}{" "}
                자동 환전은 하지 않습니다.
              </small>
            </>
          ) : (
            <small>주식 수량·평단만 변경하고 현금 잔고는 유지합니다.</small>
          )}
        </div>
      </fieldset>
      <div className={styles.preview} role="status">
        {base.market === "US" && (
          <div>
            <span>원화 주당 평균 매입단가</span>
            <strong>
              {base.averageCostKrw == null
                ? "미확인"
                : `${base.averageCostKrw.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}원`}{" "}
              →{" "}
              {preview && !fxInvalid
                ? (() => {
                    const basis = nextStockBasis(
                      base.quantity,
                      base.averageCostKrw ?? null,
                      side,
                      trade.quantity,
                      trade.price,
                      trade.fee,
                      Number(fxRate),
                    );
                    return basis === null
                      ? "미확인"
                      : `${basis.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}원`;
                  })()
                : "—"}
            </strong>
          </div>
        )}
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
        {reflectCash && selectedCash && (
          <div>
            <span>{selectedCash.name} 잔고</span>
            <strong>
              {money(cashBalance)} →{" "}
              {cashPreview ? money(cashPreview.balance) : "—"}
            </strong>
          </div>
        )}
        {side === "sell" && preview?.realisedGain !== null && preview && (
          <div>
            <span>이번 매도 손익{base.market === "US" ? " · USD" : ""}</span>
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
      {(validation ||
        cashValidation ||
        error ||
        (!cashLoading && fxInvalid && Boolean(quantity))) && (
        <p role="alert" className={styles.error}>
          {error ||
            validation ||
            cashValidation ||
            "이번 거래 적용 환율을 입력해 주세요."}
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
        <button
          type="submit"
          disabled={
            fxInvalid ||
            basisDirty ||
            !preview ||
            busy ||
            !base.revision ||
            (reflectCash && (cashLoading || Boolean(cashValidation)))
          }
        >
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
