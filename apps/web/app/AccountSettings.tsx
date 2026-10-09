"use client";

import Link from "next/link";
import { useState } from "react";
import { downloadFile } from "./download-file";
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
  loginProvider?: string;
  email?: string | null;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
  onNavigate: (view: "strategy" | "guide") => void;
  onSignOut: () => void;
};

export default function AccountSettings({
  name,
  loginProvider,
  email,
  theme,
  onThemeChange,
  onNavigate,
  onSignOut,
}: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  async function exportData() {
    setExporting(true);
    setExportError("");
    try {
      const [portfolio, holdings, accounts] = await Promise.all(
        ["/api/portfolio", "/api/holdings", "/api/accounts"].map(
          async (url) => {
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok)
              throw new Error(
                "데이터를 내려받지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.",
              );
            return res.json();
          },
        ),
      );
      downloadFile(
        `portrhythm-data-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })}.json`,
        JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            portfolio: portfolio.portfolio,
            holdings: holdings.holdings,
            accounts: accounts.accounts,
          },
          null,
          2,
        ),
        "application/json",
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "내보내기 실패");
    } finally {
      setExporting(false);
    }
  }
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
          <p>
            로그인 방식 ·{" "}
            {loginProvider === "naver"
              ? "네이버"
              : loginProvider === "kakao"
                ? "카카오"
                : loginProvider === "local-admin"
                  ? "로컬 QA"
                  : "확인되지 않음"}
          </p>
          <p>
            자산이 보이지 않으면 이전에 사용한 로그인 방식을 확인해 주세요.
            네이버와 카카오는 각각 별도 계정입니다.
          </p>
        </div>
      </section>
      <section className={styles.group} aria-labelledby="account-display">
        <h2 id="account-display">화면 설정</h2>
        <div className={styles.appearance}>
          <div>
            <strong>화면 모드</strong>
            <p>
              이 브라우저에 저장됩니다. 다른 기기에서는 별도로 선택해 주세요.
            </p>
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
            <h3>저장한 데이터 내려받기</h3>
            <p>
              계좌·보유 자산·포트 설정·입출금·자산 기록을 JSON 파일로 받습니다.
              미저장 입력은 포함하지 않습니다. 파일에는 개인 자산 정보가 있으니
              공개하지 마세요.
            </p>
            <button
              type="button"
              className={styles.exportButton}
              disabled={exporting}
              onClick={() => void exportData()}
            >
              {exporting ? "내려받는 중…" : "내 데이터 내려받기"}
            </button>
            {exportError && <p role="alert">{exportError}</p>}
            <h3>데이터 삭제와 문의</h3>
            <p>
              등록한 자산은 자산 수정에서, 입출금 내역은 자산 기록에서 삭제할 수
              있습니다. 계정 전체 삭제는 자동 제공하지 않습니다. 처리 방법
              문의는 아래 GitHub 링크를 이용하되 개인정보는 게시하지 마세요.
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
        <p>투자는 나만의 리듬으로. 내 기준을 지키며, 꾸준히.</p>
        <nav aria-label="서비스 관련 링크">
          <Link href="/about">
            서비스 소개 <ChevronRight size={12} aria-hidden="true" />
          </Link>
          <a
            href="https://github.com/PROMLEE/pf"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub 저장소 <ExternalLink size={12} aria-hidden="true" />
            <span className={styles.srOnly}> (새 탭)</span>
          </a>
          <a
            href="https://github.com/PROMLEE/pf/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            버그 제보·기능 제안 <ExternalLink size={12} aria-hidden="true" />
            <span className={styles.srOnly}> (새 탭)</span>
          </a>
        </nav>
        <p>
          GitHub 문의는 공개됩니다. 계좌번호·이메일·보유 금액은 쓰지 말고
          캡처에서도 가려 주세요.
        </p>
        <small>© {new Date().getFullYear()} PROMLEE. PortRhythm.</small>
      </footer>
    </div>
  );
}
