"use client";

import { ChevronRight } from "lucide-react";
import type { Holding } from "./holdings";
import AssetIcon from "./AssetIcon";
import styles from "./EditableHoldingRow.module.css";

export default function HoldingPositionRow({
  holding, price, averageCost, value, gain, percent, gainSign, onOpen,
}: {
  holding: Holding;
  price: string;
  averageCost: string;
  value: string;
  gain: string;
  percent: string | null;
  gainSign: "positive" | "negative" | "unknown";
  onOpen: () => void;
}) {
  const quantity = `${holding.quantity.toLocaleString("ko-KR", { maximumFractionDigits: 6 })}주`;
  return (
    <div className={styles.row}>
      <button type="button" className={`${styles.main} ${styles.positionMain}`} onClick={onOpen} aria-label={`${holding.name} 자산 상세`}>
        <span className={styles.identity}>
          <AssetIcon kind="stock" symbol={holding.symbol} name={holding.name} market={holding.market} exchange={holding.exchange} />
          <span className={styles.identityText}>
            <span className={styles.name}><strong>{holding.name}</strong><ChevronRight size={15} aria-hidden="true" /></span>
            <span className={styles.account}>{holding.broker} · {holding.account} · {holding.symbol || "코드 미확인"}</span>
            <span className={styles.positionInfo}>{quantity}</span>
          </span>
        </span>
        <span className={styles.desktopStat}><small>보유 수량</small>{quantity}</span>
        <span className={styles.positionPrices}>
          <span><small>현재가</small> {price}</span>
          <span><small>평균 매입가</small> {averageCost}</span>
        </span>
        <span className={styles.value}><small>평가액</small><strong>{value}</strong></span>
        <span className={`${styles.profit} ${styles[gainSign]}`}>
          <small>평가손익</small><strong>{gain}</strong>{percent && <span>{percent}</span>}
        </span>
      </button>
    </div>
  );
}
