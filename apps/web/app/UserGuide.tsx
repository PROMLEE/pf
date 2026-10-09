"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, Check, ChevronRight } from "lucide-react";
import styles from "./UserGuide.module.css";

type Destination =
  | "strategy"
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
    text: "주식은 잔고 캡처를 분석하거나 직접 입력하세요. 인식한 종목코드·수량·매입단가는 저장 전에 확인합니다. 비트코인과 현금은 자산 수정에서 추가하세요.",
    destination: "import",
    action: "주식 등록",
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
    text: "추가 투자금만으로 조정하거나 매도 후 매수하는 방법을 비교하세요. 하단 매수 후보에 종목을 지정하면 주식 수량 제안에 사용됩니다. 실제 주문은 직접 진행합니다.",
    destination: "rebalance",
    action: "리밸런싱",
  },
];
const questions = [
  [
    "수량과 매입단가, 자산 이름은 어디서 바꾸나요?",
    "대시보드나 보유 자산에서 종목을 누른 뒤 수정으로 이동하거나 자산 수정 메뉴를 이용하세요. 주식은 계좌별로 수정합니다. 가상자산의 매입단가는 원화 1개 기준이며, 현금·기타 자산은 이름과 평가액을 함께 바꿀 수 있습니다.",
  ],
  [
    "현재가와 환율은 직접 입력하나요?",
    "주식은 한국투자증권 API, 가상자산 원화 가격은 빗썸 공개 API로 조회합니다. 환율은 자동 모드에서 Frankfurter의 기준 환율을 사용하며 실시간 체결 환율은 아닙니다. 조회에 실패하면 마지막 확인 가격을 보여줄 수 있으니 가격 기준 시각을 확인하세요.",
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
    "허용 오차 ±5%는 어디서 정하나요?",
    "목표 설계에서 모든 포트에 적용할 허용 오차를 바꿉니다. 목표 20%, 허용 오차 ±5%p라면 현재 비중 15~25%가 범위 안입니다. 목표 비중에 대한 상대 오차 5%가 아닙니다.",
  ],
  [
    "매수 후보를 추가하면 보유 자산에도 생기나요?",
    "매수 후보는 리밸런싱에 사용할 종목 설정입니다. 등록해도 실제 보유 수량은 생기지 않습니다. 매수 후 자산을 등록하고 포트에 배정하세요.",
  ],
  [
    "자산 기록은 무엇을 보여주나요?",
    "전체·포트별 일별 추이와 직접 저장한 시점별 평가액을 확인합니다. 입출금의 실제 발생 시각을 입력하면 같은 날의 변화도 구분할 수 있습니다. 삭제 내역은 복원할 수 있으며, 기록이 쌓이기 전에는 장기간 추이를 볼 수 없습니다.",
  ],
];

export default function UserGuide({
  onNavigate,
}: {
  onNavigate?: (view: Destination) => void;
}) {
  const guideRef = useRef<HTMLElement>(null);
  const [chapter, setChapter] = useState("guide-start");

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
          <figcaption>포트 비중 · 실제 앱의 테스트 자산 예시</figcaption>
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
          매수·매도 수량과 조정 후 예상 비중을 함께 확인하세요. 가상자산은 별도
          확인할 조정 금액으로 표시되며, 주식 거래 미리보기에 포함되지 않습니다.
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
