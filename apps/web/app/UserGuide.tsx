"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, Check, ChevronRight } from "lucide-react";
import styles from "./UserGuide.module.css";

const AveragePriceCalculator = dynamic(() => import("./AveragePriceCalculator"));

type Destination =
  | "strategy"
  | "accounts"
  | "import"
  | "edit"
  | "allocation"
  | "composition"
  | "rebalance"
  | "history";
const steps: {
  title: string;
  text: string;
  destination: Destination;
  action: string;
}[] = [
  {
    title: "내 투자 기준 정하기",
    text: "미국 지수, 한국 지수, 우량주, 금처럼 원하는 포트를 만들고 목표 비중의 합계를 100%로 맞추세요. 허용 오차도 여기서 정합니다.",
    destination: "strategy",
    action: "목표 설계",
  },
  {
    title: "보유 자산 등록하기",
    text: "계좌 관리에서 증권사·계좌명을 만들고 종목을 검색해 직접 등록하세요. 잔고 캡처도 사용할 수 있습니다. 비트코인과 현금은 자산 수정에서 추가하세요.",
    destination: "accounts",
    action: "계좌·종목 등록",
  },
  {
    title: "자산을 포트에 연결하기",
    text: "각 자산이 어느 포트에 속하는지 지정하세요. 같은 종목코드의 자동 배정 규칙보다 직접 지정한 배정이 우선합니다.",
    destination: "allocation",
    action: "자산 배정",
  },
  {
    title: "현재 비중 점검하기",
    text: "원형 그래프에 마우스를 올리거나 포트를 선택하면 평가액과 목표 차이를 확인할 수 있습니다. 모바일에서는 포트를 눌러보세요.",
    destination: "composition",
    action: "포트 비중",
  },
  {
    title: "리밸런싱 준비하기",
    text: "허용 범위 밖은 자동으로 조정을 제안합니다. 범위 안은 유지하고, 직접 종목을 선택하면 목표까지 필요한 수량을 확인할 수 있습니다. 제안을 검토한 뒤 ‘이 계획으로 시작’으로 저장하고 거래를 하나씩 기록하세요.",
    destination: "rebalance",
    action: "리밸런싱",
  },
];
const questions = [
  [
    "리밸런싱 종목은 어떤 기준으로 선택하나요?",
    "자동 선택은 같은 포트에서 정규장이 열린 국내·미국 시장을 우선합니다. 둘 다 장외이거나 일정 확인에 실패하면 기존 후보 순서를 사용합니다. 주식 매수는 등록한 후보, 매도는 보유 종목에서 고르고, 가상자산은 해당 포트에 등록된 자산을 사용합니다. 직접 고른 종목은 자동으로 바꾸지 않습니다. 주식은 1주, 가상자산은 소수점 8자리 단위로 계산합니다. 계획을 시작하면 제안을 저장해 두고 거래를 순서대로 기록할 수 있습니다. 실제 주문은 직접 진행해야 합니다.",
  ],
  ["새 종목을 살 때 보유 현금을 사용할 수 있나요?", "보유 자산 → 계좌 관리 → 종목 직접 추가에서 종목을 선택하고 ‘보유 현금에서 매수금액 차감’을 켜세요. 이번 매수 수량과 주당 매수 단가, 사용할 현금을 선택하면 차감 후 잔액을 확인할 수 있습니다. 국내 주식은 원화, 미국 주식은 달러 현금만 선택할 수 있습니다. 종목 등록과 현금 차감은 함께 저장되며 잔고가 부족하면 등록하지 않습니다. 추가 수수료는 별도로 더하지 않으므로 필요하면 단가에 포함해 입력하세요. 미국 주식의 원화 매입원가는 등록 시 설정된 환율로 기록하고, 시세 조회 전에는 입력한 매수 단가를 임시 평가에 사용합니다. 기존 보유 내역을 옮겨 적거나 현금 잔고를 이미 수정했다면 이 옵션을 끄세요. 기존 종목의 추가 매수·매도는 종목 수정의 ‘현금 잔고에 함께 반영’을 사용합니다. 실제 주문이나 자동 환전은 하지 않습니다."],
  ["외부에서 들어온 투자금은 어떻게 반영하나요?", "자산 수정 → 입출금·이체 → 외부 입금에서 입금할 현금 자산과 금액을 선택하고 확인 후 확정하세요. 등록 시점의 현금 잔고와 자산 기록의 입출금 내역에 함께 반영되므로, 같은 내역을 자산 기록에 다시 입력하지 마세요. 외부 출금도 같은 방식으로 잔고에서 차감합니다. 원화는 1원, 달러는 소수점 둘째 자리까지 지원하며 달러 입출금 기록은 현재 환율로 원화 환산합니다. 달러 입금의 매입 환율은 모르면 비워둘 수 있습니다. 이미 잔고와 연결한 입출금은 반대 방향의 새 입출금으로 정정합니다. 달러를 정정했다면 평균 환전 단가도 현금 자산에서 확인하세요. 실제 송금과 자동 환전은 하지 않습니다."],
  ["계좌 간 현금 이동은 어떻게 기록하나요?", "계좌 관리의 ‘현금 관리·이체’ 또는 자산 수정의 ‘입출금·이체 → 내 계좌 간 이체’을 이용하세요. 현금 자산의 연결 계좌를 선택해 저장한 뒤, 출금·입금 현금과 금액을 정하고 예상 잔액을 확인해 확정합니다. 원화끼리·달러끼리만 지원하며 실제 송금이나 자동 환전은 하지 않습니다. 두 잔액을 함께 바꾸고 외부 입출금으로 기록하지 않으므로 전체 평가액은 유지됩니다. 포트 배정이 다르면 포트별 비중은 달라집니다. 달러는 출금 자산의 기존 환전 원가를 이동해 입금 자산 원가와 가중평균합니다. 원가를 모르는 금액이 섞이면 입금 자산의 원가는 미확인으로 처리하며 확인된 손익의 집계 범위가 달라질 수 있습니다. 최근 이체 30건을 확인할 수 있고, 잘못 기록한 이체는 반대 방향으로 새로 기록해 잔액을 되돌릴 수 있습니다."],
  ["현금·RP 포트는 어떻게 조정하나요?", "목표 설계의 계산 설정에서 ‘목표 비중을 맞출 현금 포트’를 선택합니다. 현금 목표액은 추가 투입금까지 포함한 총자산에 목표 비중을 곱해 계산합니다. 현금이 많으면 초과분을 선택한 종목의 매수에 쓰고, 부족하면 추가 투입금과 선택한 주식·가상자산의 매도 대금에서 목표액을 먼저 남깁니다. 허용 범위 밖인 포트는 자동 계산하고, 범위 안은 종목을 직접 선택한 경우만 계산합니다. 모든 매수·매도를 반영한 현금 잔액이 최종 비중에 포함됩니다. 1주 단위나 후보·거래 제외 때문에 남은 예산도 선택한 현금 포트에 포함되므로 목표와 차이가 남을 수 있습니다. 현금·RP 등 직접 입력 자산만 있는 포트를 선택할 수 있습니다. 계좌 간 자금 이동과 환전이 가능하다는 가정의 원화 환산 미리보기이며, 실제 계좌·통화별 잔액을 자동으로 바꾸거나 주문하지 않습니다. 직접 거래 후 실제 잔고를 수정하세요."],
  ["공지 알림은 어떻게 받나요?", "설정 → 알림·앱 설치에서 알림 켜기를 누르고 브라우저 권한을 허용하세요. 기기별 설정이며 테스트 알림으로 연결을 확인할 수 있습니다. 아이폰은 iOS 16.4 이상에서 Safari 공유 메뉴 → 홈 화면에 추가 후 설치한 앱으로 열어야 합니다. 알림 차단은 브라우저 설정에서 해제해야 하며, 로그아웃하면 이 브라우저의 알림 연결도 해제됩니다. 알림을 누르면 로그인 후 해당 공지를 확인합니다. 예약 발송과 수신 시각은 네트워크·기기 설정에 따라 지연될 수 있습니다."],
  ["환율 손익은 어떻게 켜고 계산하나요?", "전체 메뉴 → 설정 → 손익 표시에서 손익에 환율 변동 포함을 켜세요. 총평가액·비중·리밸런싱은 언제나 현재 환율을 씁니다. 미국 주식은 원화 평가액에서 원화 매입원가를 빼고 달러 현금은 평균 환전 단가 대비 손익을 계산합니다. 미국 주식 수정의 기존 보유분 원가 설정에서 원화 주당 평단 또는 평균 매수 환율을 입력하세요. 자산 수정·달러 상세에서는 평균 환전 단가를 입력합니다. 모르는 과거 원가는 비워 두면 손익 미확인으로 표시하며 확인된 자산만 합계에 포함합니다. 추가 매수는 거래 환율로 원화 평단도 갱신하고 일부 매도는 남은 평단을 유지합니다. 달러 차감은 기존 현금 환전 단가를 유지하고 매도 대금 유입은 거래 환율로 현금 원가를 가중평균합니다. 일간 손익은 주가 전일 종가와 현재 환율 기준일 이전의 최근 ECB 기준환율을 비교한 참고 값입니다. 수동 환율 또는 이전 환율 조회 실패 시 해외 일간 손익은 미확인입니다. 국내 상장 해외 ETF에는 환율 손익을 별도로 더하지 않습니다. 이 표시는 보유분의 평가손익이며 매도 실현손익 누적이나 세금 계산은 포함하지 않습니다."],
  [
    "수량과 매입단가, 자산 이름은 어디서 바꾸나요?",
    "대시보드나 보유 자산에서 종목을 눌러 수정하거나 자산 수정·계좌 관리 메뉴를 이용하세요. 기존 주식은 계좌별로 추가 매수 또는 매도를 선택하고 이번 거래 수량·주당 단가를 입력합니다. 추가 매수 평단은 기존 매입금액에 신규 매수금액과 입력한 수수료를 더해 새 총수량으로 나눕니다. 일부 매도는 남은 주식의 평단을 유지하고 전량 매도는 보유 목록에서 제거합니다. 기존 평단을 모르면 전체 수량·평단 직접 수정에서 먼저 입력하세요. 현금 잔고에 함께 반영을 켜고 현금 자산을 선택하면 매수 금액과 거래 비용을 차감하고, 매도 대금에서 거래 비용을 뺀 금액을 더합니다. 국내 주식은 원화 자산, 미국 주식은 달러 자산에 반영하며 자동 환전은 하지 않습니다. 현금 잔고를 이미 반영했다면 이 옵션을 끄세요. 전체 수량·평단 직접 수정은 현금 잔고를 변경하지 않습니다. 가상자산은 원화 개당 매입가를, 현금·기타 자산은 이름과 평가액을 수정할 수 있습니다.",
  ],
  [
    "현재가와 환율은 직접 입력하나요?",
    "주식은 서버에 연결된 한국투자증권 또는 토스증권 API, 가상자산은 빗썸 원화 가격을 사용합니다. 설정의 주식 시세 연결에서 우선 공급자와 보조 조회 여부를 확인할 수 있습니다. 화면이 활성 상태일 때 주식은 약 5분, 가상자산은 약 1분마다 갱신을 시도하며, 조회 시각과 실제 체결 시각은 다를 수 있습니다. 조회 실패 시 마지막 확인 가격이나 캡처 가격을 사용할 수 있습니다. 외화 자산은 자동 일일 기준환율(Frankfurter·ECB) 또는 직접 입력한 환율로 원화 환산합니다. 이는 실제 거래·환전 환율과 다를 수 있습니다. 리밸런싱은 자동 시세를 우선하며, 새 종목에 시세가 없을 때 임시 가격을 사용합니다. 실제 주문 가격은 증권사·거래소에서 확인하세요.",
  ],
  [
    "전체 손익과 일간 손익은 어떻게 다른가요?",
    "전체 손익은 매입단가가 있는 주식·가상자산의 평가손익입니다. 일간 손익은 API의 전일 종가와 현재가 차이에 현재 보유 수량을 곱합니다. 대시보드 토글은 종목별 손익에도 적용됩니다. 실현손익·세금·수수료·배당과 과거 매입 환율 차이는 포함하지 않습니다.",
  ],
  [
    "계좌 잔고도 자동으로 동기화되나요?",
    "현재가는 조회하지만 증권사나 빗썸 계좌의 보유 수량을 자동으로 가져오지는 않습니다. 거래 후 수량과 매입단가를 직접 수정하거나 새 잔고 캡처를 검토해 반영하세요.",
  ],
  [
    "리밸런싱 허용 오차는 어떻게 정하나요?",
    "목표 설계에서 기준을 선택합니다. 전체 자산 비중 기준은 목표 20%에 ±2%p라면 18~22%를 허용합니다. 각 포트 목표 금액 기준은 목표 1,000만 원에 ±10%라면 900만~1,100만 원을 허용합니다. 추가 투입금도 포함해 목표 금액을 계산하며, 두 기준의 설정값은 각각 보관합니다.",
  ],
  [
    "매수 후보를 추가하면 보유 자산에도 생기나요?",
    "매수 후보는 리밸런싱에 사용할 종목 설정입니다. 등록해도 실제 보유 수량은 생기지 않습니다. 매수 후 자산을 등록하고 포트에 배정하세요.",
  ],
  [
    "자산 기록은 무엇을 보여주나요?",
    "전체·포트별 일별 최신 평가액 추이를 확인합니다. 그래프를 누르면 날짜와 금액을 볼 수 있습니다. 입출금의 실제 발생 시각을 입력하면 같은 날의 변화도 구분할 수 있습니다. 삭제 내역은 복원할 수 있으며, 기록이 쌓이기 전에는 장기간 추이를 볼 수 없습니다.",
  ],
];

export default function UserGuide({
  onNavigate,
}: {
  onNavigate?: (view: Destination) => void;
}) {
  const guideRef = useRef<HTMLElement>(null);
  const [chapter, setChapter] = useState("guide-start");
  const [calculatorLoaded, setCalculatorLoaded] = useState(false);

  useEffect(() => {
    const root = guideRef.current;
    if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reveals = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.visible = "true";
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    reveals.forEach((element) => revealObserver.observe(element));
    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = root.getBoundingClientRect();
      const distance = Math.max(1, bounds.height - window.innerHeight);
      root.style.setProperty(
        "--guide-progress",
        String(Math.max(0, Math.min(1, -bounds.top / distance))),
      );
      const chapters = Array.from(
        root.querySelectorAll<HTMLElement>("[data-chapter]"),
      );
      const current = chapters
        .filter(
          (section) =>
            section.getBoundingClientRect().top <= window.innerHeight * 0.4,
        )
        .at(-1);
      const timeline = root.querySelector<HTMLElement>("[data-timeline]");
      if (timeline) {
        const track = timeline.getBoundingClientRect();
        root.style.setProperty(
          "--step-progress",
          String(
            Math.max(
              0,
              Math.min(
                1,
                (window.innerHeight * 0.6 - track.top) / track.height,
              ),
            ),
          ),
        );
      }
      setChapter(current?.id ?? "guide-start");
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onMotionChange = () => {
      root.dataset.reduceMotion = String(motion.matches);
    };
    onMotionChange();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    motion.addEventListener("change", onMotionChange);
    return () => {
      revealObserver.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      motion.removeEventListener("change", onMotionChange);
    };
  }, []);

  function action(destination: Destination, label: string) {
    return onNavigate ? (
      <button type="button" onClick={() => onNavigate(destination)}>
        {label}
        <ArrowRight size={16} />
      </button>
    ) : null;
  }
  return (
    <article ref={guideRef} className={styles.guide}>
      <header className={styles.hero}>
        <div className={styles.heroCopy} data-reveal>
          <span>PORTRHYTHM GUIDE</span>
          <h1>
            내 포트폴리오의
            <br />첫 리듬을 만들어보세요
          </h1>
          <p>
            목표를 정하고, 자산을 연결하고, 비중을 점검하세요.
            <br />
            처음에는 이 순서대로 시작하면 됩니다.
          </p>
          {!onNavigate && (
            <a className={styles.loginLink} href="/">
              로그인하고 시작하기 <ArrowRight size={16} />
            </a>
          )}
          <a className={styles.scrollCue} href="#guide-start">
            <ArrowDown size={16} /> 아래로 내려 첫 리듬 시작하기
          </a>
        </div>
        <div
          className={styles.blueprint}
          data-reveal
          aria-label="목표 비중 예시: 미국 지수 35%, 한국 지수 25%, 우량주 20%, 금 10%, 비트코인 10%"
        >
          <span className={styles.blueprintLabel}>MY PORTFOLIO RHYTHM</span>
          <div className={styles.ring}>
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                stroke="var(--line)"
                strokeWidth="10"
              />
              {[35, 25, 20, 10, 10].map((weight, index, values) => (
                <circle
                  key={index}
                  className={styles.ringSegment}
                  cx="60"
                  cy="60"
                  r="48"
                  pathLength="100"
                  fill="none"
                  stroke={
                    ["#177c88", "#42a994", "#6986b3", "#cba664", "#d88975"][
                      index
                    ]
                  }
                  strokeWidth="10"
                  strokeDasharray={`${weight - 1.2} ${100 - weight + 1.2}`}
                  strokeDashoffset={
                    -values
                      .slice(0, index)
                      .reduce((sum, value) => sum + value, 0)
                  }
                  style={
                    {
                      "--segment": `${weight - 1.2} ${100 - weight + 1.2}`,
                      "--delay": `${index * 90}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </svg>
            <div>
              <small>나만의 기준</small>
              <strong>
                100<span>%</span>
              </strong>
              <small>목표 비중 예시</small>
            </div>
          </div>
          <div className={styles.rhythmLegend}>
            {[
              "미국 지수 35%",
              "한국 지수 25%",
              "우량주 20%",
              "금 10%",
              "비트코인 10%",
            ].map((label, index) => (
              <span key={label}>
                <i
                  style={{
                    background: [
                      "#177c88",
                      "#42a994",
                      "#6986b3",
                      "#cba664",
                      "#d88975",
                    ][index],
                  }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>
      </header>
      <nav className={styles.chapterNav} aria-label="가이드 목차">
        <div className={styles.readProgress} aria-hidden="true" />
        {[
          ["guide-start", "시작 순서"],
          ["guide-edit", "자산 수정"],
          ["guide-rebalance", "리밸런싱"],
          ["guide-faq", "궁금한 점"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            aria-current={chapter === id ? "location" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <section id="guide-start" data-chapter className={styles.section}>
        <h2 data-reveal>처음 시작하는 5단계</h2>
        <ol className={styles.steps} data-timeline>
          {steps.map((step, index) => (
            <li
              key={step.destination}
              data-reveal
              style={{ "--delay": `${index * 40}ms` } as CSSProperties}
            >
              <span className={styles.number}>{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                {action(step.destination, step.action)}
              </div>
            </li>
          ))}
        </ol>
        <figure data-reveal className={styles.screenReveal}>
          <img
            src="/guide/desktop-composition.jpg"
            width="1280"
            height="720"
            loading="lazy"
            alt="포트 비중 화면에서 선택한 포트의 평가액과 목표 비중 차이를 확인하는 예시"
          />
          <figcaption>포트별 평가액과 목표 비중 비교</figcaption>
        </figure>
      </section>
      <section id="guide-edit" data-chapter className={styles.section}>
        <h2 data-reveal>거래 후에는 여기서 수정하세요</h2>
        <p>
          대시보드에서 자산을 누르면 상세 화면에서 해당 자산을 바로 수정하고 저장할 수 있습니다.
        </p>
        <ul className={styles.editList}>
          <li>
            <Check size={18} />
            <span>
              <strong>주식</strong>계좌별 보유 수량과 평균 매입단가
            </span>
          </li>
          <li>
            <Check size={18} />
            <span>
              <strong>가상자산</strong>보유 수량과 원화 매입단가
            </span>
          </li>
          <li>
            <Check size={18} />
            <span>
              <strong>현금·기타 자산</strong>자산 이름과 평가액
            </span>
          </li>
        </ul>
        {action("edit", "자산 수정으로 이동")}
        <figure data-reveal className={styles.screenReveal}>
          <img
            src="/guide/desktop-asset-edit.jpg"
            width="1265"
            height="1206"
            loading="lazy"
            alt="주식, 가상자산 매입단가와 현금 이름을 수정하는 자산 수정 화면"
          />
          <figcaption>입력 후 저장 버튼으로 반영합니다.</figcaption>
        </figure>
      </section>
      <section id="guide-rebalance" data-chapter className={styles.section}>
        <h2 data-reveal>목표와 달라졌다면, 조정 방법 비교하기</h2>
        <p>
          매수·매도 수량과 모든 제안을 반영한 예상 비중을 함께 확인하세요.
          주식은 1주, 가상자산은 소수점 8자리 단위로 계산합니다.
        </p>
        <figure data-reveal className={styles.screenReveal}>
          <img
            src="/guide/desktop-rebalance.jpg"
            width="1265"
            height="1078"
            loading="lazy"
            alt="리밸런싱의 주식 매수 매도 제안과 예상 비중 비교 화면"
          />
          <figcaption>
            제안은 검토용이며 주문을 실행하지 않습니다. 수수료·세금은 별도로
            확인하세요.
          </figcaption>
        </figure>
      </section>
      <section id="guide-faq" data-chapter className={styles.section}>
        <h2 data-reveal>자주 묻는 질문</h2>
        {questions.map(([question, answer]) => (
          <details key={question} className={styles.question}>
            <summary>
              {question}
              <ChevronRight size={17} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>
      <section id="guide-calculator" className={styles.section}>
        <details className={styles.calculatorTool} onToggle={event => { if (event.currentTarget.open) setCalculatorLoaded(true); }}>
          <summary>
            <span><strong>물타기·불타기 계산기</strong><small>추가 매수 후 평단가를 미리 계산해 보세요.</small></span>
            <ChevronRight size={18} />
          </summary>
          {calculatorLoaded && <AveragePriceCalculator />}
        </details>
      </section>
      <footer data-reveal className={styles.end}>
        <strong>투자는 나만의 리듬으로. 내 기준을 지키며, 꾸준히.</strong>
        <p>현재 보유 자산을 확인한 후 목표 비중을 정해보세요.</p>
        {onNavigate ? (
          action("strategy", "내 목표 설계하기")
        ) : (
          <a href="/">
            로그인하고 시작하기
            <ArrowRight size={16} />
          </a>
        )}
      </footer>
    </article>
  );
}
