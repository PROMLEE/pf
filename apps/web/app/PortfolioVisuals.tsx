"use client";

import { useState } from "react";
import type { Holding } from "./holdings";
import { portfolioValues, type Portfolio } from "./portfolio-model";
import styles from "./portfolio.module.css";

type Props = { portfolio: Portfolio; holdings: Holding[] };
type Mode = "actual" | "target";
const circumference = 2 * Math.PI * 46;
const percent = (value: number) => `${value.toFixed(1)}%`;
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

export default function PortfolioVisuals({ portfolio, holdings }: Props) {
  const [mode, setMode] = useState<Mode>("actual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      value: values.get(bucket.id) ?? 0,
    })),
    ...(unassigned > 0
      ? [
          {
            id: "unassigned",
            name: "미분류",
            color: "#a7b3c5",
            target: 0,
            actual: (unassigned / total) * 100,
            value: unassigned,
          },
        ]
      : []),
  ];
  const sortedItems = [...items].sort(
    (a, b) =>
      (showTarget ? b.target - a.target : b.actual - a.actual) ||
      a.name.localeCompare(b.name, "ko"),
  );
  const selected = sortedItems.find((item) => item.id === selectedId) ?? null;
  let offset = 0;

  return (
    <section
      className={styles.allocationCard}
      aria-label="포트폴리오 비중 원형 그래프"
    >
      <div className={styles.allocationHead}>
        <div>
          <h2>포트별 자산 비중</h2>
          <p>그래프 조각이나 포트 이름을 선택해 평가액과 비중을 확인하세요.</p>
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
            role="group"
            aria-label={`${showTarget ? "목표" : "현재"} 비중: ${sortedItems.map((item) => `${item.name} ${percent(showTarget ? item.target : item.actual)}`).join(", ")}`}
          >
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="#eaf0f5"
              strokeWidth="13"
            />
            {sortedItems.map((item) => {
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
                  className={
                    selectedId === item.id ? styles.allocationArcActive : ""
                  }
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.name} 현재 ${percent(item.actual)}, 목표 ${percent(item.target)}, 평가액 ${won.format(item.value)}원`}
                  aria-pressed={selectedId === item.id}
                  onPointerEnter={() => setSelectedId(item.id)}
                  onFocus={() => setSelectedId(item.id)}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(item.id);
                    }
                  }}
                >
                  <title>{`${item.name} ${percent(share)}`}</title>
                </circle>
              );
            })}
          </svg>
          <div className={styles.allocationCenter}>
            <span>
              {selected
                ? selected.name
                : showTarget
                  ? "목표 비중"
                  : "현재 비중"}
            </span>
            <strong>
              {selected
                ? percent(showTarget ? selected.target : selected.actual)
                : portfolio.buckets.length}
              {!selected && <small>개 포트</small>}
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
          {sortedItems.map((item) => (
            <button
              type="button"
              className={styles.allocationLegendRow}
              key={item.id}
              aria-pressed={selectedId === item.id}
              onPointerEnter={() => setSelectedId(item.id)}
              onFocus={() => setSelectedId(item.id)}
              onClick={() => setSelectedId(item.id)}
            >
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
            </button>
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
      {selected && (
        <div
          className={styles.allocationDetail}
          role="status"
          aria-live="polite"
        >
          <strong>
            <i style={{ background: selected.color }} />
            {selected.name}
          </strong>
          <div>
            <span>현재 평가액</span>
            <b>{won.format(selected.value)}원</b>
          </div>
          <div>
            <span>현재 / 목표</span>
            <b>
              {percent(selected.actual)} / {percent(selected.target)}
            </b>
          </div>
          <div>
            <span>목표와 차이</span>
            <b
              className={
                selected.actual - selected.target < 0
                  ? styles.allocationUnder
                  : styles.allocationOver
              }
            >
              {selected.actual - selected.target > 0 ? "+" : ""}
              {(selected.actual - selected.target).toFixed(1)}%p
            </b>
          </div>
        </div>
      )}
    </section>
  );
}
