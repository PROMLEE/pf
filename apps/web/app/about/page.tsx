import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, SlidersHorizontal, Layers3, RefreshCw } from "lucide-react";
import Experience, { RebalanceDemo } from "./Experience";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "PortRhythm 소개 | 투자는 나만의 리듬으로",
  description: "국내·미국 주식, 가상자산, 현금을 나만의 목표 비중으로 관리하세요. 실제 자산과 목표를 비교하고 다음 리밸런싱을 준비하는 PortRhythm.",
  alternates: { canonical: "https://pf.promleeblog.com/about" },
  openGraph: {
    title: "PortRhythm — 투자는 나만의 리듬으로",
    description: "내 목표 비중부터 다음 조정까지. 나만의 포트폴리오를 꾸준히 관리하세요.",
    url: "https://pf.promleeblog.com/about",
    type: "website",
    locale: "ko_KR",
  },
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <a href="#about-main" className={styles.skip}>본문으로 이동</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><span>PR</span>PortRhythm</Link>
        <nav aria-label="서비스 소개 메뉴"><Link href="/guide">사용 가이드</Link><Link href="/" className={styles.headerCta}>시작하기 <ArrowUpRight size={15} /></Link></nav>
      </header>
      <Experience>
        <main id="about-main" className={styles.main}>
          <section className={styles.hero}>
            <div data-reveal>
              <span className={styles.eyebrow}>내 투자 기준을, 매일 확인할 수 있게</span>
              <h1>투자는<br /><em>나만의 리듬으로.</em></h1>
              <p>나만의 목표 비중과 실제 자산을 연결하세요.<br className={styles.desktopBreak} /> 어디가 많고 적은지 확인하고, 다음 조정을 준비합니다.</p>
              <div className={styles.actions}><Link href="/" className={styles.primary}>내 포트폴리오 시작하기 <ArrowRight size={18} /></Link><a href="#how-it-works" className={styles.textLink}>어떻게 관리하나요? ↓</a></div>
              <span className={styles.assetScope}>국내·미국 주식 / 가상자산 / 현금</span>
            </div>
            <figure className={styles.heroVisual} data-reveal>
              <div className={styles.visualBackdrop}><span>목표를 정하고.<br />현재를 확인하고.<br /><b>필요할 때 조정하고.</b></span></div>
              <img src="/about/mobile-dashboard.jpg" width={390} height={844} alt="총 평가액, 일간 손익, 정렬한 종목을 보여주는 PortRhythm 모바일 대시보드" fetchPriority="high" />
            </figure>
          </section>

          <section id="how-it-works" className={styles.section} data-reveal>
            <div className={styles.sectionIntro}><span className={styles.eyebrow}>포트폴리오를 운영하는 하나의 흐름</span><h2>내 계획이 실제 자산과<br />이어지도록.</h2><p>목표 설계부터 자산 배정, 비중 점검, 조정 수량 검토와 기록까지 연결합니다.</p></div>
            <div className={styles.features}>
              <article><SlidersHorizontal size={24} /><h3>내 기준으로 설계</h3><p>지수, 우량주, 금, 비트코인, 현금. 필요한 포트를 만들고 이름·목표 비중·허용 오차를 직접 정하세요.</p></article>
              <article><Layers3 size={24} /><h3>흩어진 자산을 연결</h3><p>여러 계좌의 같은 종목을 코드로 연결하고, 국내·미국 주식과 가상자산·현금을 원화로 함께 확인하세요.</p></article>
              <article><RefreshCw size={24} /><h3>다음 조정을 준비</h3><p>목표에서 벗어난 비중을 확인하고, 주식의 예상 매수·매도 수량과 조정 후 비중·남는 자금을 검토하세요.</p></article>
            </div>
          </section>

          <section className={`${styles.section} ${styles.screenSection}`} data-reveal>
            <div><span className={styles.eyebrow}>목표와 현재를 한눈에</span><h2>많아진 비중, 부족한 비중.<br />차이가 보이면 기준이 생깁니다.</h2><p>원형 그래프에서 포트를 선택해 평가액과 현재·목표 비중을 확인하세요. 같은 종목을 여러 계좌에 보유해도 내 투자 계획에 연결할 수 있습니다.</p><ul className={styles.checks}><li><Check size={16} />종목코드 규칙 또는 직접 자산 배정</li><li><Check size={16} />포트별 평가액과 비중 차이 확인</li><li><Check size={16} />포트별 추이와 입출금 기록</li></ul></div>
            <figure className={styles.screen}><img src="/guide/desktop-composition.jpg" width={1280} height={720} loading="lazy" alt="원형 그래프와 포트별 현재·목표 비중을 비교하는 화면" /></figure>
          </section>

          <section className={styles.section} data-reveal>
            <div className={styles.sectionIntro}><span className={styles.eyebrow}>장기적인 원칙을 일상의 관리로</span><h2>커진 비중은 덜고,<br />부족한 비중은 채우세요.</h2><p>상승해 목표 비중을 넘은 자산은 일부 이익 실현을, 상대적으로 부족해진 자산은 추가 매수를 검토할 기준이 생깁니다. 새 투자금으로 부족한 쪽을 채우는 방법도 있습니다.</p></div>
            <RebalanceDemo />
            <p className={styles.context}>조정 기준은 가격 등락보다 목표 대비 비중입니다. 매도가 항상 차익 실현인 것은 아니며, 하락했다고 무조건 추가 매수하지 않습니다. 투자 근거와 목표가 여전히 적절한지 확인하세요.</p>
          </section>

          <section className={`${styles.section} ${styles.screenSection}`} data-reveal>
            <figure className={styles.screen}><img src="/guide/desktop-rebalance.jpg" width={1265} height={1078} loading="lazy" alt="예상 주식 매수·매도 수량과 조정 후 비중을 보여주는 리밸런싱 화면" /></figure>
            <div><span className={styles.eyebrow}>차이를 보고, 수량으로 검토</span><h2>내 상황에 맞는<br />조정 방법을 고르세요.</h2><p>매도 후 매수와 신규 자금 매수를 비교하고, 이번에 조정하지 않을 종목은 제외하세요. 실제 거래는 증권사·거래소에서 직접 진행합니다.</p><p>주식은 1주 단위와 예산을 반영합니다. 가상자산은 초과·부족 금액을 검토하며, 비용·체결 가격에 따라 실제 결과는 달라질 수 있습니다.</p></div>
          </section>

          <section className={styles.section} data-reveal>
            <div className={styles.sectionIntro}><span className={styles.eyebrow}>꾸준한 투자를 위한 생각</span><h2>전체를 보고.<br />원칙을 지키고. 필요할 때 움직이고.</h2></div>
            <div className={styles.quotes}>
              <blockquote><p>“Stay the course.”</p><span>정한 방향을 꾸준히 유지하라.</span><footer><b>존 C. 보글</b><small>뱅가드 창립자</small><a href="https://boglecenter.net/wp-content/uploads/JCB_AAII0505.pdf" target="_blank" rel="noopener noreferrer">2005년 AAII 연설 원문 ↗<span className={styles.srOnly}> (새 탭)</span></a></footer></blockquote>
              <blockquote><p>“these should be measured for the portfolio as a whole.”</p><span>위험과 수익은 포트폴리오 전체를 기준으로 측정해야 한다.</span><footer><b>해리 마코위츠</b><small>1990년 노벨 경제학상 수상자</small><a href="https://www.nobelprize.org/uploads/2018/06/markowitz-lecture.pdf" target="_blank" rel="noopener noreferrer">1990년 노벨 강연 원문 ↗<span className={styles.srOnly}> (새 탭)</span></a></footer></blockquote>
              <blockquote><p>“For investors as a whole, returns decrease as motion increases.”</p><span>투자자 전체로 보면, 움직임이 늘수록 수익은 줄어든다.</span><footer><b>워런 버핏</b><small>버크셔 해서웨이 2005년 주주서한</small><a href="https://www.berkshirehathaway.com/letters/2005ltr.pdf" target="_blank" rel="noopener noreferrer">주주서한 원문 · p.18 ↗<span className={styles.srOnly}> (새 탭)</span></a></footer></blockquote>
            </div>
            <p className={styles.context}>공개 원문의 짧은 발췌와 한국어 번역입니다. 인물·기관의 서비스 추천을 의미하지 않습니다. 목표 비중과 리밸런싱은 위험 노출을 관리하는 방법이며 수익이나 손실 방지를 보장하지 않습니다. <a href="https://investor.vanguard.com/investor-resources-education/portfolio-management/rebalancing-your-portfolio" target="_blank" rel="noopener noreferrer">Vanguard의 리밸런싱 설명 ↗<span className={styles.srOnly}> (새 탭)</span></a></p>
          </section>

          <section className={`${styles.section} ${styles.faq}`} data-reveal>
            <div><span className={styles.eyebrow}>시작하기 전에</span><h2>무엇을 할 수 있나요?</h2></div>
            <div>
              <details><summary>계좌가 자동으로 동기화되나요?</summary><p>실제 계좌 잔고를 자동으로 가져오지는 않습니다. 주식은 지원하는 증권사 잔고 캡처를 검토하거나 직접 입력하고, 가상자산·현금도 직접 등록합니다. 거래 후 수량을 수정하면 시세 조회와 평가에 반영됩니다.</p></details>
              <details><summary>가격은 어떻게 확인하나요?</summary><p>한국투자증권 API로 국내·미국 주식 가격을, 빗썸 공개 API로 원화 가상자산 가격을 확인합니다. 화면이 활성 상태일 때 주식은 약 5분, 가상자산은 약 1분 간격으로 갱신을 시도합니다. 미국 자산은 자동 일일 기준환율 또는 직접 입력 환율로 원화 환산합니다.</p></details>
              <details><summary>앱이 자동으로 매매해주나요?</summary><p>예상 조정 수량과 비중을 검토하는 도구입니다. 주문은 직접 진행하며, 계좌별 거래 가능 여부·수수료·세금·환전 비용은 실제 거래 전에 확인합니다. 목표 비중은 사용자가 정하고, 앱이 최적 전략을 산출하지는 않습니다.</p></details>
              <details><summary>처음에는 무엇부터 하면 되나요?</summary><p>목표 포트와 비중을 만들고, 보유 자산을 등록해 각 포트에 배정하세요. 현재 비중과 목표의 차이를 확인한 뒤 필요한 조정을 검토합니다. <Link href="/guide">사용 가이드에서 시작 순서 보기 →</Link></p></details>
            </div>
          </section>

          <section className={styles.finalCta} data-reveal><span className={styles.eyebrow}>나만의 투자 리듬을 만들어보세요</span><h2>내 기준으로 시작하고,<br />꾸준히 확인하세요.</h2><Link href="/" className={styles.primary}>PortRhythm 시작하기 <ArrowRight size={18} /></Link><Link href="/guide" className={styles.textLink}>먼저 사용 가이드 보기</Link></section>
        </main>
      </Experience>
      <footer className={styles.footer}><span>© {new Date().getFullYear()} PROMLEE · PortRhythm</span><nav aria-label="서비스 관련 링크"><Link href="/guide">사용 가이드</Link><a href="https://github.com/PROMLEE/pf" target="_blank" rel="noopener noreferrer">GitHub<span className={styles.srOnly}> (새 탭)</span></a><a href="https://github.com/PROMLEE/pf/issues" target="_blank" rel="noopener noreferrer">문의·기능 제안<span className={styles.srOnly}> (새 탭)</span></a></nav></footer>
    </div>
  );
}
