"use client";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ChartNoAxesCombined,
  PieChart,
  RefreshCw,
} from "lucide-react";
import styles from "./PortfolioDashboard.module.css";
const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
export default function PortfolioDashboard({
  total,
  gain,
  percent,
  gainView,
  gainNote,
  refreshing,
  onRefresh,
  controls,
  children,
  composition,
  targetTitle,
  targetDetail,
  onRebalance,
  onComposition,
  onHistory,
  onEdit,
  metadata,
}: {
  total: number;
  gain: number | null;
  percent: number | null;
  gainView: "total" | "daily";
  gainNote: string;
  refreshing: boolean;
  onRefresh: () => void;
  controls: ReactNode;
  children: ReactNode;
  composition: ReactNode;
  targetTitle: string;
  targetDetail: string;
  onRebalance: () => void;
  onComposition: () => void;
  onHistory: () => void;
  onEdit: () => void;
  metadata: ReactNode;
}) {
  const direction =
    gain === null ? "" : gain >= 0 ? styles.positive : styles.negative;
  return (
    <div className={styles.dashboard}>
      <div className={styles.main}>
        <section className={styles.hero} aria-label="내 자산 요약">
          <div className={styles.heroHead}>
            <h1>총 평가액</h1>
            <button
              type="button"
              className={styles.refresh}
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="시세 새로고침"
            >
              <RefreshCw
                size={17}
                className={refreshing ? styles.spinning : ""}
              />
              <span>{refreshing ? "갱신 중" : "시세 갱신"}</span>
            </button>
          </div>
          <div className={styles.total}>
            {money.format(total)}
            <span>원</span>
          </div>
          <div className={styles.returnLine}>
            <span>{gainView === "daily" ? "일간 손익" : "전체 손익"}</span>
            <strong className={direction}>
              {gain === null
                ? "—"
                : `${gain > 0 ? "+" : ""}${money.format(gain)}원`}
            </strong>
            {percent !== null && (
              <span className={`${styles.returnPercent} ${direction}`}>
                {percent > 0 ? "+" : ""}
                {percent.toFixed(2)}%
              </span>
            )}
          </div>
          {gainNote && <p className={styles.note}>{gainNote}</p>}
          <div className={styles.shortcuts}>
            <button type="button" onClick={onComposition}>
              <PieChart size={17} />
              포트 비중
              <ArrowRight size={14} />
            </button>
            <button type="button" onClick={onHistory}>
              <ChartNoAxesCombined size={17} />
              자산 추이
              <ArrowRight size={14} />
            </button>
          </div>
        </section>
        <section className={styles.assets} aria-label="보유 자산">
          <div className={styles.assetHeading}>
            <h2>보유 자산</h2>
            <button type="button" onClick={onEdit}>
              자산 관리
              <ArrowRight size={14} />
            </button>
          </div>
          <div className={styles.controls}>{controls}</div>
          {children}
        </section>
        <div className={styles.metadata}>{metadata}</div>
      </div>
      <aside className={styles.aside} aria-label="포트폴리오 점검">
        {composition}
        <section className={styles.target}>
          <span>목표 비중 점검</span>
          <h2>{targetTitle}</h2>
          <p>{targetDetail}</p>
          <button type="button" onClick={onRebalance}>
            리밸런싱 확인
            <ArrowRight size={17} />
          </button>
        </section>
      </aside>
    </div>
  );
}
