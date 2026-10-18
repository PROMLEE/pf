"use client";
import { useEffect, useRef, useState } from "react";
import type { Holding } from "./holdings";
import type { Portfolio } from "./portfolio-model";
import {
  previewRunReplacement,
  runReplacementChoices,
  type RebalanceRun,
  type RunItem,
  type RunReplacement,
} from "./rebalance-runs";
import styles from "./RebalancePlans.module.css";
const qty = (n: number) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: 8 });
const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export default function RunReplacementForm({
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
  onSaved: (run: RebalanceRun) => void;
  onCancel: () => void;
  onDirty: (value: boolean) => void;
}) {
  const [selection, setSelection] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<RunReplacement | null>(null);
  useEffect(() => {
    onDirty(true);
    return () => onDirty(false);
  }, [onDirty]);
  const choices = runReplacementChoices(run, item, portfolio, holdings).filter(
    (c) =>
      !(c.item.holdingId && c.item.holdingId === item.holdingId) &&
      !(c.item.assetId && c.item.assetId === item.assetId),
  );
  let preview: ReturnType<typeof previewRunReplacement> | null = null;
  let issue = "";
  if (selection)
    try {
      preview = previewRunReplacement(
        run,
        item.id,
        selection,
        portfolio,
        holdings,
      );
    } catch (e) {
      issue =
        e instanceof Error ? e.message : "변경 수량을 계산하지 못했습니다.";
    }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preview || busy || preview.fundingShortfall > 1e-6) return;
    const input: RunReplacement = {
      changeId: pending.current?.changeId ?? crypto.randomUUID(),
      runId: run.id,
      revision: run.revision,
      itemId: item.id,
      selection,
      expectedQuantity: preview.to.quantity,
      expectedPrice: preview.to.unitPrice,
    };
    if (
      pending.current &&
      JSON.stringify(pending.current) !== JSON.stringify(input)
    ) {
      setError(
        "이전 변경 결과를 먼저 확인하세요. 닫고 계획을 새로고침하면 확인할 수 있습니다.",
      );
      return;
    }
    pending.current = input;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/rebalance-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replace", replacement: input }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status < 500) pending.current = null;
        throw Error(data.message ?? "종목을 변경하지 못했습니다.");
      }
      onSaved(data.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "종목 변경 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={styles.tradeForm}
      aria-label={`${item.bucketName} 남은 거래 종목 변경`}
      onSubmit={save}
    >
      <strong>남은 {item.side === "buy" ? "매수" : "매도"} 종목 변경</strong>
      <p>
        이미 반영한 거래와 다른 포트는 유지합니다. 남은 계획 금액 안에서 새
        수량을 계산합니다.
      </p>
      <fieldset disabled={busy}>
        <label>
          변경할 종목
          <select
            required
            value={selection}
            onChange={(e) => {
              setSelection(e.target.value);
              setError("");
            }}
          >
            <option value="">같은 포트의 종목 선택</option>
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        {!choices.length && (
          <p>
            다른 보유 종목이나 매수 후보가 없습니다. 목표 설계에서 같은 포트에
            후보를 등록한 뒤 다시 확인하세요.
          </p>
        )}
        {preview && (
          <div className={styles.replacementPreview}>
            <span>
              남은 계획 금액 <strong>{won(preview.budget)}</strong>
            </span>
            <span>
              {preview.to.name}{" "}
              <strong>
                {qty(preview.to.quantity)}
                {preview.to.kind === "stock" ? "주" : "개"}{" "}
                {item.side === "buy" ? "매수" : "매도"}
              </strong>
            </span>
            <span>
              변경 후 거래 금액 <strong>{won(preview.to.amountKrw)}</strong>
            </span>
            {preview.unused >= 1 && (
              <small>
                {item.side === "buy"
                  ? `수량 단위 때문에 남는 ${won(preview.unused)}은 다른 종목에 자동 배분하지 않습니다.`
                  : `매도 예상 대금이 기존보다 ${won(preview.unused)} 줄어듭니다.`}
              </small>
            )}
          </div>
        )}
        {preview && preview.fundingShortfall > 1e-6 && (
          <p role="alert" className={styles.error}>
            다른 매수 계획에 필요한 예산이 {won(preview.fundingShortfall)}{" "}
            부족해집니다. 다른 종목을 선택하거나 새 계획으로 조정하세요.
          </p>
        )}
        {(error || issue) && (
          <p role="alert" className={styles.error}>
            {error || issue}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={onCancel}>
            취소
          </button>
          <button
            className={styles.primary}
            disabled={!preview || preview.fundingShortfall > 1e-6}
          >
            {busy ? "변경 중…" : "남은 종목 변경"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
