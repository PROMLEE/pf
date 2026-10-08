"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./about.module.css";

export default function Experience({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !root.current) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.visible = "true";
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    root.current.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  return <div ref={root}>{children}</div>;
}

export function RebalanceDemo() {
  const [weight, setWeight] = useState(60);
  const [mode, setMode] = useState<"trade" | "add">("trade");
  const gap = weight - 50;
  const amount = Math.abs(gap) * 10;
  const over = gap >= 0 ? "A" : "B";
  const under = gap >= 0 ? "B" : "A";
  const budget = amount * 2;
  return (
    <div className={styles.demo}>
      <div className={styles.demoVisual}>
        <div className={styles.ring} style={{ "--weight": `${weight}%` } as CSSProperties} role="img" aria-label={`현재 비중 A ${weight}%, B ${100 - weight}%`}>
          <span>현재 비중<strong>{weight} : {100 - weight}</strong><small>목표 50 : 50</small></span>
        </div>
        <div className={styles.legend}><span><i />자산 A {weight}%</span><span><i />자산 B {100 - weight}%</span></div>
      </div>
      <div className={styles.demoControls}>
        <span className={styles.eyebrow}>비중이 달라지면, 조정도 달라집니다</span>
        <h3>슬라이더로 직접 확인해보세요.</h3>
        <p>총 평가액 1,000만원, 두 자산의 목표 비중이 각각 50%인 예시입니다.</p>
        <label htmlFor="demo-weight">자산 A의 현재 비중 <strong>{weight}%</strong></label>
        <input id="demo-weight" type="range" min="20" max="80" step="1" value={weight} onChange={(event) => setWeight(Number(event.target.value))} />
        <div className={styles.mode} role="group" aria-label="예시 조정 방식">
          <button type="button" aria-pressed={mode === "trade"} onClick={() => setMode("trade")}>매도 후 매수</button>
          <button type="button" aria-pressed={mode === "add"} onClick={() => setMode("add")}>신규 자금으로 매수</button>
        </div>
        <div className={styles.demoResult} aria-live="polite" aria-atomic="true">
          {gap === 0 ? <><strong>목표 비중과 일치합니다.</strong><span>이 예시에서는 조정할 금액이 없습니다.</span></> : mode === "trade" ? <>
            <strong>자산 {over} <b className={styles.sell}>{amount}만원 매도</b><br />자산 {under} <b className={styles.buy}>{amount}만원 매수</b></strong>
            <span>조정 후 각 500만원 · 50 : 50</span>
          </> : <><strong>자산 {under}에 <b className={styles.buy}>{budget}만원 추가</b></strong><span>조정 후 각 {500 + amount}만원 · 50 : 50</span></>}
        </div>
        <small className={styles.demoNote}>기능 이해를 위한 가상 예시입니다. 비용·허용 오차·거래 단위는 제외했습니다. 실제 앱은 주식 1주 단위와 예산을 반영해 조정 수량을 제안합니다.</small>
      </div>
    </div>
  );
}
