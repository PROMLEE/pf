"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { Holding } from "./holdings";
import AssetIcon from "./AssetIcon";
import styles from "./EditableHoldingRow.module.css";
export default function EditableHoldingRow({
  holding,
  price,
  value,
  gain,
  percent,
  gainSign,
  editing,
  editDisabled,
  removeDisabled,
  onEdit,
  onRemove,
}: {
  holding: Holding;
  price: string;
  value: string;
  gain: string;
  percent: string | null;
  gainSign: "positive" | "negative" | "unknown";
  editing: boolean;
  editDisabled: boolean;
  removeDisabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      ) {
        if (details.current) details.current.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (details.current) details.current.open = false;
        summary.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  function act(action: () => void) {
    if (details.current) details.current.open = false;
    action();
  }
  const quantity = `${holding.quantity.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}주`;
  return (
    <div
      className={`${styles.row} ${editing ? styles.active : ""}`}
      id={`edit-stock-${holding.id}`}
    >
      <button
        type="button"
        className={styles.main}
        onClick={onEdit}
        disabled={editDisabled || holding.readOnly}
        aria-label={`${holding.name} ${holding.readOnly ? "메리츠 연동 읽기 전용" : "자산 수정"}`}
        aria-describedby={`holding-summary-${holding.id}`}
        aria-expanded={editing}
      >
        <span id={`holding-summary-${holding.id}`} className={styles.srOnly}>
          {holding.broker} {holding.account}, {holding.symbol}, {quantity}, 현재가 {price}, 평가액{" "}
          {value}, 평가손익 {gain} {percent ?? ""}
        </span>
        <span className={styles.identity}>
          <AssetIcon
            kind="stock"
            symbol={holding.symbol}
            name={holding.name}
            market={holding.market}
            exchange={holding.exchange}
          />
          <span className={styles.identityText}>
            <span className={styles.name}>
              <strong>{holding.name}</strong>
              {holding.readOnly ? <small>메리츠 연동 · 읽기 전용</small> : editing ? (
                <small>수정 중</small>
              ) : (
                <ChevronRight size={15} aria-hidden="true" />
              )}
            </span>
            <span className={styles.account}>
              {holding.broker} · {holding.account} ·{" "}
              {holding.symbol || "코드 미확인"}
            </span>
            <span className={styles.positionInfo}>
              {quantity} · 현재가 {price}
            </span>
          </span>
        </span>
        <span className={styles.desktopStat}>
          <small>보유 수량</small>
          {quantity}
        </span>
        <span className={styles.desktopStat}>
          <small>현재가</small>
          {price}
        </span>
        <span className={styles.value}>
          <small>평가액</small>
          <strong>{value}</strong>
        </span>
        <span className={`${styles.profit} ${styles[gainSign]}`}>
          <small>평가손익</small>
          <strong>{gain}</strong>
          {percent && <span>{percent}</span>}
        </span>
      </button>
      {!holding.readOnly && <details
        ref={details}
        className={styles.more}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary ref={summary} aria-label={`${holding.name} 관리 메뉴`}>
          <Ellipsis size={20} />
        </summary>
        <div
          className={styles.menu}
          role="group"
          aria-label={`${holding.name} 관리 옵션`}
        >
          <button
            type="button"
            disabled={editDisabled || holding.readOnly}
            onClick={() => act(onEdit)}
          >
            <Pencil size={16} />
            수량·거래 수정
          </button>
          <button
            type="button"
            className={styles.remove}
            disabled={removeDisabled || holding.readOnly}
            onClick={() => act(onRemove)}
          >
            <Trash2 size={16} />
            등록 자산 삭제
          </button>
        </div>
      </details>}
    </div>
  );
}
