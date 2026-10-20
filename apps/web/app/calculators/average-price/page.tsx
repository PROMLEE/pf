import type { Metadata } from "next";
import Link from "next/link";
import AveragePriceCalculator from "../../AveragePriceCalculator";
import styles from "./page.module.css";

const title = "물타기·불타기 계산기 | 주식·코인 평단가 계산 · PortRhythm";
const description =
  "추가 매수 후 평균 매입단가와 필요 자금을 계산하세요. 주식·코인의 수량·예산·목표 평단가로 물타기와 불타기를 로그인 없이 계산할 수 있습니다.";
export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: {
    canonical: "https://pf.promleeblog.com/calculators/average-price",
  },
  openGraph: {
    title,
    description,
    url: "https://pf.promleeblog.com/calculators/average-price",
    type: "website",
    locale: "ko_KR",
    siteName: "PortRhythm",
  },
};
export default function AveragePricePage() {
  return (
    <main className={styles.page}>
      <nav>
        <Link href="/about">PortRhythm</Link>
        <Link href="/">내 포트폴리오</Link>
      </nav>
      <header>
        <h1>물타기·불타기 계산기</h1>
        <p>추가 매수 전, 바뀌는 평단가와 필요한 자금을 확인하세요.</p>
      </header>
      <AveragePriceCalculator />
      <section className={styles.guide}>
        <details>
          <summary>현금 잔고 안에서 최대 몇 주 살 수 있나요?</summary>
          <p>
            ‘현금 잔고로 수량 채우기’를 펼치면 25%·50%·최대 수량을 채울 수
            있습니다. 이 공개 계산기에서는 현금을 직접 입력하고, 로그인 후 종목
            상세의 계산기에서는 같은 통화로 등록한 현금 자산을 선택할 수
            있습니다. 수수료와 실제 주문 가능 금액은 별도로 확인하세요.
          </p>
        </details>
        <h2>평단가는 어떻게 달라지나요?</h2>
        <p>
          기존 총매입금액과 추가 매수 금액을 더한 뒤, 매수 후 총수량으로
          나눕니다. 낮은 가격에 추가 매수하면 평단가가 내려가고, 높은 가격에
          추가 매수하면 올라갑니다.
        </p>
        <p>
          예를 들어 10주를 평균 100,000원에 보유하고 80,000원에 5주를 추가
          매수하면, 총 15주·총매입금액 1,400,000원·평단가 약 93,333원이 됩니다.
        </p>
        <details>
          <summary>목표 평단가와 예산으로도 계산할 수 있나요?</summary>
          <p>
            ‘금액으로’를 선택하면 예산 안에서 살 수 있는 수량을, ‘목표
            평단가로’를 선택하면 목표에 도달하는 데 필요한 최소 추가 수량과
            자금을 계산합니다. 목표 평단가는 기존 평단가와 추가 매수 단가
            사이여야 합니다.
          </p>
        </details>
      </section>
      <footer>
        <Link href="/guide">사용 가이드</Link>
        <Link href="/about">목표 비중과 리밸런싱도 관리하기 →</Link>
      </footer>
    </main>
  );
}
