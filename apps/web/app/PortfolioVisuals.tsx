import type { Holding } from "./holdings";
import { holdingValueKrw, type Portfolio } from "./portfolio-model";
import styles from "./portfolio.module.css";

type Props = { portfolio: Portfolio; holdings: Holding[] };
const percent = (value: number) => `${value.toFixed(1)}%`;

export default function PortfolioVisuals({ portfolio, holdings }: Props) {
  const values = holdings.reduce(
    (sum, holding) => {
      sum[holding.market] += holdingValueKrw(holding, portfolio.usdKrw);
      return sum;
    },
    { KR: 0, US: 0 },
  );
  const total = values.KR + values.US;
  const domestic = total ? (values.KR / total) * 100 : 0;
  const overseas = total ? (values.US / total) * 100 : 0;

  return (
    <section className={styles.marketCard} aria-label="국내·미국 주식 비중">
      <div className={styles.marketCopy}>
        <small>보유 주식 구성</small>
        <strong>국내 · 미국</strong>
        <span>직접 입력 자산 제외 · 설정 환율 적용</span>
      </div>
      {total > 0 ? (
        <>
          <svg
            className={styles.marketDonut}
            viewBox="0 0 120 120"
            role="img"
            aria-label={`국내 ${percent(domestic)}, 미국 ${percent(overseas)}`}
          >
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="#e8eef8"
              strokeWidth="15"
            />
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="#4b72e8"
              strokeWidth="15"
              strokeDasharray={`${domestic * 2.89} ${Math.max(0, 289 - domestic * 2.89)}`}
              transform="rotate(-90 60 60)"
            />
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="#20ad9b"
              strokeWidth="15"
              strokeDasharray={`${overseas * 2.89} ${Math.max(0, 289 - overseas * 2.89)}`}
              strokeDashoffset={-domestic * 2.89}
              transform="rotate(-90 60 60)"
            />
          </svg>
          <div className={styles.marketLegend}>
            <div>
              <i style={{ background: "#4b72e8" }} />
              <span>국내</span>
              <b>{percent(domestic)}</b>
            </div>
            <div>
              <i style={{ background: "#20ad9b" }} />
              <span>미국</span>
              <b>{percent(overseas)}</b>
            </div>
          </div>
        </>
      ) : (
        <span className={styles.marketEmpty}>
          가격이 있는 종목을 추가하면 표시됩니다.
        </span>
      )}
    </section>
  );
}
