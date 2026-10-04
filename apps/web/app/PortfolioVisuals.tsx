"use client";

import { useState } from "react";
import type { Holding } from "./holdings";
import { portfolioValues, type Portfolio } from "./portfolio-model";
import styles from "./portfolio.module.css";

type Props = { portfolio: Portfolio; holdings: Holding[] };
type Mode = "actual" | "target";
const circumference = 2 * Math.PI * 46;
const percent = (value: number) => `${value.toFixed(1)}%`;

export default function PortfolioVisuals({ portfolio, holdings }: Props) {
  const [mode, setMode] = useState<Mode>("actual");
  const { values, unassigned, total } = portfolioValues(portfolio, holdings);
  const hasValues = total > 0;
  const showTarget = mode === "target" || !hasValues;
  const targetTotal = portfolio.buckets.reduce(
    (sum, bucket) => sum + bucket.targetPercent,
    0,
  );
  const items = [
    ...portfolio.buckets.map((bucket) => ({
      id: bucket.id,
      name: bucket.name,
      color: bucket.color,
      target: bucket.targetPercent,
      actual: hasValues ? ((values.get(bucket.id) ?? 0) / total) * 100 : 0,
    })),
    ...(unassigned > 0
      ? [
          {
            id: "unassigned",
            name: "미분류",
            color: "#a7b3c5",
            target: 0,
            actual: (unassigned / total) * 100,
          },
        ]
      : []),
  ];
  let offset = 0;

  return (
    <section
      className={styles.allocationCard}
      aria-label="포트폴리오 비중 원형 그래프"
    >
      <div className={styles.allocationHead}>
        <div>
          <small>ALLOCATION</small>
          <h2>포트별 자산 비중</h2>
          <p>현재 보유 비중과 설정한 목표를 비교하세요.</p>
        </div>
        {hasValues && (
          <div
            className={styles.allocationSwitch}
            role="group"
            aria-label="비중 보기"
          >
            <button
              type="button"
              aria-pressed={mode === "actual"}
              onClick={() => setMode("actual")}
            >
              현재
            </button>
            <button
              type="button"
              aria-pressed={mode === "target"}
              onClick={() => setMode("target")}
            >
              목표
            </button>
          </div>
        )}
      </div>
      <div className={styles.allocationBody}>
        <div className={styles.allocationChart}>
          <svg
            viewBox="0 0 120 120"
            role="img"
            aria-label={`${showTarget ? "목표" : "현재"} 비중: ${items.map((item) => `${item.name} ${percent(showTarget ? item.target : item.actual)}`).join(", ")}`}
          >
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="#eaf0f5"
              strokeWidth="13"
            />
            {items.map((item) => {
              const share = Math.max(
                0,
                showTarget && targetTotal > 100
                  ? (item.target / targetTotal) * 100
                  : showTarget
                    ? item.target
                    : item.actual,
              );
              const start = offset;
              offset += share;
              if (share === 0) return null;
              return (
                <circle
                  key={item.id}
                  cx="60"
                  cy="60"
                  r="46"
                  fill="none"
                  stroke={item.color}
                  strokeWidth="13"
                  strokeDasharray={`${(share / 100) * circumference} ${circumference}`}
                  strokeDashoffset={-(start / 100) * circumference}
                  transform="rotate(-90 60 60)"
                >
                  <title>{`${item.name} ${percent(share)}`}</title>
                </circle>
              );
            })}
          </svg>
          <div className={styles.allocationCenter}>
            <span>{showTarget ? "목표 비중" : "현재 비중"}</span>
            <strong>
              {portfolio.buckets.length}
              <small>개 포트</small>
            </strong>
          </div>
        </div>
        <div className={styles.allocationLegend}>
          <div className={styles.allocationLegendHead}>
            <span>포트</span>
            <span>{showTarget ? "목표" : "현재"}</span>
            <span>{showTarget ? "현재" : "목표"}</span>
            <span>차이</span>
          </div>
          {items.map((item) => (
            <div className={styles.allocationLegendRow} key={item.id}>
              <span>
                <i style={{ background: item.color }} />
                {item.name}
              </span>
              <strong>{percent(showTarget ? item.target : item.actual)}</strong>
              <span>
                {item.id === "unassigned"
                  ? "—"
                  : percent(showTarget ? item.actual : item.target)}
              </span>
              <span
                className={
                  item.actual - item.target < 0
                    ? styles.allocationUnder
                    : styles.allocationOver
                }
              >
                {hasValues
                  ? `${item.actual - item.target > 0 ? "+" : ""}${(item.actual - item.target).toFixed(1)}%p`
                  : "—"}
              </span>
            </div>
          ))}
          {!hasValues && (
            <p className={styles.allocationHint}>
              자산을 등록하면 현재 비중이 표시됩니다. 지금은 목표 구성을
              보여줍니다.
            </p>
          )}
          {showTarget && targetTotal !== 100 && (
            <p className={styles.allocationHint}>
              목표 합계 {percent(targetTotal)} · 저장하려면 100%로 맞춰 주세요.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
