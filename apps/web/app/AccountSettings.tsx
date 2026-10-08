"use client";

import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  LogOut,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
} from "lucide-react";
import styles from "./AccountSettings.module.css";

type Props = {
  name?: string | null;
  email?: string | null;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  onNavigate: (view: "strategy" | "guide") => void;
  onSignOut: () => void;
};

export default function AccountSettings({
  name,
  email,
  theme,
  onThemeChange,
  onNavigate,
  onSignOut,
}: Props) {
  return (
    <div className={styles.account}>
      <header className={styles.head}>
        <h1>내 계정</h1>
        <p>계정과 이용 환경을 관리하세요.</p>
      </header>
      <section className={styles.identity} aria-label="로그인 계정">
        <span className={styles.avatar} aria-hidden="true">
          {name?.slice(0, 1) || "P"}
        </span>
        <div>
          <small>로그인한 계정</small>
          <h2>{name || "내 계정"}</h2>
          {email && <p>{email}</p>}
        </div>
      </section>
      <section className={styles.group} aria-labelledby="account-display">
        <h2 id="account-display">화면 설정</h2>
        <div className={styles.appearance}>
          <div>
            <strong>화면 모드</strong>
            <p>이 브라우저에 저장됩니다.</p>
          </div>
          <fieldset className={styles.themes}>
            <legend>화면 모드 선택</legend>
            {(["light", "dark"] as const).map((mode) => (
              <label
                key={mode}
                className={theme === mode ? styles.selected : ""}
              >
                <input
                  type="radio"
                  name="account-theme"
                  value={mode}
                  checked={theme === mode}
                  onChange={() => onThemeChange(mode)}
                />
                {mode === "light" ? <Sun size={17} /> : <Moon size={17} />}
                {mode === "light" ? "라이트" : "다크"}
              </label>
            ))}
          </fieldset>
        </div>
      </section>
      <section className={styles.group} aria-labelledby="account-plan">
        <h2 id="account-plan">투자 설정</h2>
        <button
          className={styles.menuRow}
          type="button"
          onClick={() => onNavigate("strategy")}
        >
          <Settings2 size={21} />
          <span>
            <strong>목표 비중과 리밸런싱 기준</strong>
            <small>내 포트 구성과 허용 오차 설정</small>
          </span>
          <ChevronRight size={18} />
        </button>
      </section>
      <section className={styles.group} aria-labelledby="account-help">
        <h2 id="account-help">이용 안내</h2>
        <button
          className={styles.menuRow}
          type="button"
          onClick={() => onNavigate("guide")}
        >
          <BookOpen size={21} />
          <span>
            <strong>사용 가이드</strong>
            <small>자산 등록·수정부터 비중 점검까지</small>
          </span>
          <ChevronRight size={18} />
        </button>
        <details className={styles.dataInfo}>
          <summary>
            <ShieldCheck size={21} />
            <span>내 데이터는 어떻게 관리되나요?</span>
            <ChevronRight size={18} />
          </summary>
          <div>
            <h3>자산은 로그인 계정에 저장됩니다</h3>
            <p>
              등록한 자산과 포트 설정은 같은 계정으로 다시 로그인하면 확인할 수
              있습니다.
            </p>
            <h3>잔고 캡처 원본은 저장하지 않습니다</h3>
            <p>
              캡처는 브라우저에서 분석하고, 확인 후 저장한 종목 정보만
              보관합니다.
            </p>
            <h3>보유 수량은 직접 관리합니다</h3>
            <p>
              시세는 자동으로 조회합니다. 거래 후 보유 수량과 매입단가는 자산
              수정에서 업데이트해 주세요.
            </p>
          </div>
        </details>
      </section>
      <div className={styles.signOutRow}>
        <button type="button" onClick={onSignOut}>
          <LogOut size={17} />
          로그아웃
        </button>
      </div>
      <footer className={styles.serviceInfo} aria-label="서비스 정보">
        <h2>PortRhythm</h2>
        <p>투자는 리듬을 타듯, 내 기준으로 꾸준히.</p>
        <nav aria-label="서비스 관련 링크">
          <a
            href="https://github.com/PROMLEE"
            target="_blank"
            rel="noopener noreferrer"
          >
            개발자 GitHub <ExternalLink size={12} aria-hidden="true" />
            <span className={styles.srOnly}> (새 탭)</span>
          </a>
        </nav>
        <small>© {new Date().getFullYear()} PROMLEE. PortRhythm.</small>
      </footer>
    </div>
  );
}
