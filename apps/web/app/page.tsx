"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  FileUp,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  Holding,
  Market,
  RecognizedHolding,
  recognizeHoldings,
} from "./holdings";
import PortfolioBuilder from "./PortfolioBuilder";
import styles from "./page.module.css";

type View = "portfolio" | "overview" | "holdings" | "import" | "settings";
type Instrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string | null;
};
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const dollars = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (value: number, market: Market) =>
  market === "KR" ? `${won.format(value)}원` : `$${dollars.format(value)}`;
const valueOf = (row: Holding) =>
  row.quantity * (row.currentPrice ?? row.capturedPrice ?? 0);
const gainOf = (row: Holding) =>
  row.averageCost == null || (row.currentPrice ?? row.capturedPrice) == null
    ? null
    : valueOf(row) - row.quantity * row.averageCost;
const signedMoney = (value: number, market: Market) =>
  `${value > 0 ? "+" : ""}${money(value, market)}`;

async function data<T>(response: Response): Promise<T> {
  const result = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(result.message || "요청에 실패했습니다.");
  return result;
}

export default function PortfolioPage() {
  const { data: session, status: authStatus } = useSession();
  const [view, setView] = useState<View>("portfolio");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [broker, setBroker] = useState("메리츠");
  const [account, setAccount] = useState("기본 계좌");
  const [market, setMarket] = useState<Market>("US");
  const [draft, setDraft] = useState<RecognizedHolding[]>([]);
  const [captureName, setCaptureName] = useState("");
  const [busy, setBusy] = useState(false);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [filter, setFilter] = useState<"ALL" | Market>("ALL");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [legacy, setLegacy] = useState<Holding[]>([]);
  const [resolvingIndex, setResolvingIndex] = useState<number | null>(null);
  const [instrumentMatches, setInstrumentMatches] = useState<
    Record<number, Instrument[]>
  >({});
  const [savedInstrumentMatches, setSavedInstrumentMatches] = useState<
    Record<string, Instrument[]>
  >({});
  const [savedResolvingId, setSavedResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let active = true;
    try {
      const previous = JSON.parse(
        localStorage.getItem("pf-holdings-v1") ?? "[]",
      ) as Holding[];
      if (Array.isArray(previous)) setLegacy(previous);
    } catch {
      /* Ignore invalid data from an older local version. */
    }
    setLoading(true);
    fetch("/api/holdings", { cache: "no-store" })
      .then((response) => data<{ holdings: Holding[] }>(response))
      .then((result) => {
        if (active) setHoldings(result.holdings);
      })
      .catch((error) => {
        if (active)
          setNotice(
            error instanceof Error
              ? error.message
              : "자산을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authStatus]);

  const totals = useMemo(
    () =>
      holdings.reduce(
        (sum, row) => {
          sum[row.market] += valueOf(row);
          if (row.currentPrice !== null) sum.quoted++;
          if (row.currentPrice === null && row.capturedPrice === null)
            sum.missing++;
          const gain = gainOf(row);
          if (gain !== null) {
            sum.gain[row.market] += gain;
            sum.costKnown[row.market]++;
          }
          return sum;
        },
        {
          KR: 0,
          US: 0,
          quoted: 0,
          missing: 0,
          gain: { KR: 0, US: 0 },
          costKnown: { KR: 0, US: 0 },
        },
      ),
    [holdings],
  );

  const brokers = useMemo(() => {
    const rows = new Map<string, { KR: number; US: number; count: number }>();
    for (const row of holdings) {
      const entry = rows.get(row.broker) ?? { KR: 0, US: 0, count: 0 };
      entry[row.market] += valueOf(row);
      entry.count++;
      rows.set(row.broker, entry);
    }
    return [...rows.entries()];
  }, [holdings]);

  const shown = useMemo(
    () =>
      holdings
        .filter((row) => filter === "ALL" || row.market === filter)
        .filter((row) =>
          `${row.name} ${row.symbol} ${row.broker} ${row.account}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort(
          (a, b) => a.market.localeCompare(b.market) || valueOf(b) - valueOf(a),
        ),
    [holdings, filter, search],
  );

  function go(next: View) {
    setView(next);
    setMenuOpen(false);
    setNotice("");
  }

  async function importCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("이미지를 선택해 주세요.");
      return;
    }
    setBusy(true);
    setDraft([]);
    setCaptureName(file.name);
    setNotice("이미지를 읽는 중입니다. 첫 실행에는 언어 파일을 내려받습니다.");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["kor", "eng"]);
      let text = "";
      try {
        text = (await worker.recognize(file)).data.text;
      } finally {
        await worker.terminate();
      }
      const mirae = text.includes("미래에셋증권");
      if (mirae) {
        setBroker("미래에셋");
        setAccount("전체 계좌");
        setMarket("KR");
      }
      const found = recognizeHoldings(text, mirae ? "KR" : market);
      setDraft(found);
      setNotice(
        found.length
          ? `${found.length}개 종목을 찾았습니다. ${mirae ? "CMA/RP와 퇴직신탁은 제외했습니다. 평가금액에서 주당 가격을 계산했습니다. " : ""}저장 전 종목명·코드·수량·가격을 확인하세요.`
          : "종목을 찾지 못했습니다. 화면 종류를 확인하거나 직접 추가해 주세요.",
      );
    } catch {
      setNotice("이미지를 읽지 못했습니다. 직접 종목을 추가할 수 있습니다.");
    } finally {
      setBusy(false);
    }
  }

  function editDraft(
    index: number,
    key: keyof RecognizedHolding,
    value: string,
  ) {
    setDraft((rows) =>
      rows.map((row, position) =>
        position !== index
          ? row
          : {
              ...row,
              ...(key === "name" ? { symbol: "", exchange: null } : {}),
              ...(key === "symbol" ? { exchange: null } : {}),
              [key]:
                key === "quantity"
                  ? Number(value)
                  : key === "capturedPrice" || key === "averageCost"
                    ? value === ""
                      ? null
                      : Number(value)
                    : value,
            },
      ),
    );
  }

  function useInstrument(index: number, instrument: Instrument) {
    setDraft((rows) =>
      rows.map((row, position) =>
        position === index
          ? {
              ...row,
              name: instrument.name,
              symbol: instrument.symbol,
              exchange: instrument.exchange,
            }
          : row,
      ),
    );
    setInstrumentMatches((current) => ({ ...current, [index]: [] }));
    setNotice(
      `${instrument.name} · ${instrument.symbol}${instrument.exchange ? ` (${instrument.exchange})` : ""} 코드로 확인했습니다.`,
    );
  }

  async function resolveInstrument(index: number) {
    const row = draft[index];
    if (!row) return;
    const query = (row.symbol || row.name).trim();
    if (!query) {
      setNotice("종목명 또는 티커를 입력한 뒤 코드 찾기를 눌러 주세요.");
      return;
    }
    setResolvingIndex(index);
    try {
      const result = await data<{ instruments: Instrument[] }>(
        await fetch(
          `/api/instruments?market=${row.market}&query=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        ),
      );
      if (result.instruments.length === 1) {
        useInstrument(index, result.instruments[0]);
      } else if (result.instruments.length > 1) {
        setInstrumentMatches((current) => ({
          ...current,
          [index]: result.instruments,
        }));
        setNotice("후보를 골라 종목 코드를 확정해 주세요.");
      } else {
        setInstrumentMatches((current) => ({ ...current, [index]: [] }));
        setNotice(
          "한국투자증권 종목 마스터에서 일치하는 종목을 찾지 못했습니다.",
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "종목 코드를 찾지 못했습니다.",
      );
    } finally {
      setResolvingIndex(null);
    }
  }

  async function applySavedInstrument(row: Holding, instrument: Instrument) {
    try {
      const result = await data<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: row.id,
            market: row.market,
            name: instrument.name,
            symbol: instrument.symbol,
            exchange: instrument.exchange,
          }),
        }),
      );
      setHoldings(result.holdings);
      setQuoteVersion((version) => version + 1);
      setSavedInstrumentMatches((current) => ({ ...current, [row.id]: [] }));
      setNotice(
        `${instrument.name} · ${instrument.symbol} 코드를 저장했습니다.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "종목 코드를 저장하지 못했습니다.",
      );
    } finally {
      setSavedResolvingId(null);
    }
  }

  async function resolveSavedInstrument(row: Holding) {
    setSavedResolvingId(row.id);
    try {
      const query = row.symbol || row.name;
      const result = await data<{ instruments: Instrument[] }>(
        await fetch(
          `/api/instruments?market=${row.market}&query=${encodeURIComponent(query)}`,
          { cache: "no-store" },
        ),
      );
      if (result.instruments.length === 1) {
        await applySavedInstrument(row, result.instruments[0]);
      } else if (result.instruments.length > 1) {
        setSavedInstrumentMatches((current) => ({
          ...current,
          [row.id]: result.instruments,
        }));
        setNotice("후보를 골라 종목 코드를 확정해 주세요.");
      } else {
        setNotice(
          "일치하는 종목을 찾지 못했습니다. 종목명을 다시 입력해 주세요.",
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "종목 코드를 찾지 못했습니다.",
      );
    } finally {
      setSavedResolvingId(null);
    }
  }

  async function saveDraft() {
    if (!broker.trim() || !account.trim()) {
      setNotice("증권사와 계좌 이름을 입력해 주세요.");
      return;
    }
    if (
      !draft.length ||
      draft.some(
        (row) =>
          !row.name.trim() ||
          !Number.isFinite(row.quantity) ||
          row.quantity <= 0 ||
          (row.capturedPrice !== null &&
            (!Number.isFinite(row.capturedPrice) || row.capturedPrice <= 0)) ||
          (row.averageCost !== null &&
            (!Number.isFinite(row.averageCost) || row.averageCost <= 0)) ||
          (row.market === "US" &&
            !/^[A-Z.]{1,10}$/.test(row.symbol.trim().toUpperCase())) ||
          (row.market === "KR" &&
            row.symbol.trim() !== "" &&
            !/^[0-9A-Z]{6}$/.test(row.symbol.trim().toUpperCase())),
      )
    ) {
      setNotice(
        "종목명·코드·수량을 확인해 주세요. 국내 코드는 비워둘 수 있지만 시세 조회에는 필요합니다.",
      );
      return;
    }
    const capturedAt = new Date().toISOString();
    const incoming: Holding[] = draft.map((row) => ({
      id: crypto.randomUUID(),
      broker: broker.trim(),
      account: account.trim(),
      market: row.market,
      name: row.name.trim(),
      symbol: row.symbol.trim().toUpperCase(),
      exchange: row.exchange ?? null,
      quantity: row.quantity,
      capturedPrice:
        row.capturedPrice && row.capturedPrice > 0 ? row.capturedPrice : null,
      averageCost:
        row.averageCost && row.averageCost > 0 ? row.averageCost : null,
      capturedAt,
      currentPrice: null,
      quoteLabel: null,
      quoteCheckedAt: null,
    }));
    setBusy(true);
    try {
      const result = await data<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holdings: incoming }),
        }),
      );
      setHoldings(result.holdings);
      setDraft([]);
      setView("holdings");
      setNotice(`${incoming.length}개 종목을 저장했습니다.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeHolding(id: string) {
    try {
      const result = await data<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }),
      );
      setHoldings(result.holdings);
      setNotice("종목을 삭제했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "삭제하지 못했습니다.",
      );
    }
  }

  async function refreshQuotes() {
    setQuoteBusy(true);
    setNotice("시세를 조회하는 중입니다.");
    try {
      const result = await data<{
        holdings: Holding[];
        quotes: { price: number | null; error?: string }[];
      }>(await fetch("/api/quotes", { method: "POST" }));
      setHoldings(result.holdings);
      setQuoteVersion((version) => version + 1);
      const count = result.quotes.filter(
        (quote) => quote.price !== null,
      ).length;
      const firstError = result.quotes.find((quote) => quote.error)?.error;
      setNotice(
        `${count}개 종목의 시세를 갱신했습니다.${result.quotes.length > count ? ` ${result.quotes.length - count}개는 조회되지 않았습니다.` : ""}${firstError ? ` ${firstError}` : ""}`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "시세를 조회하지 못했습니다.",
      );
    } finally {
      setQuoteBusy(false);
    }
  }

  async function migrateLegacy() {
    setBusy(true);
    try {
      const result = await data<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holdings: legacy }),
        }),
      );
      setHoldings(result.holdings);
      localStorage.removeItem("pf-holdings-v1");
      setLegacy([]);
      setNotice("이 브라우저의 기존 자산을 계정으로 옮겼습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "기존 자산을 옮기지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (authStatus === "loading")
    return (
      <div className={styles.splash}>
        <span className={styles.logo}>P</span> 자산 화면을 준비하고 있습니다
      </div>
    );

  if (authStatus !== "authenticated")
    return (
      <div className={styles.authShell}>
        <section className={styles.authVisual}>
          <div className={styles.authBrand}>
            <span className={styles.logo}>P</span> PORTFOLIO
          </div>
          <div className={styles.authPitch}>
            <span className={styles.kicker}>YOUR PORTFOLIO, YOUR PRINCIPLES</span>
            <h1>
              자산을 모으고,
              <br />
              투자 원칙을 지키세요.
            </h1>
            <p>
              목표 비중을 직접 설계하고 국내·미국 종목을 연결하세요.
              현재 비중과 목표의 차이, 다음 조정이 필요한 자산까지 한눈에 볼 수 있습니다.
            </p>
            <div className={styles.authGraphic}>
              <div className={styles.authGraphicHead}>
                <span>PORTFOLIO BLUEPRINT</span>
                <strong>목표 비중 예시</strong>
              </div>
              <div className={styles.authGraphicBody}>
                <div className={styles.authPreviewRing} aria-label="미국 지수 35%, 한국 지수 25%, 우량주 20%, 금 10%, 비트코인 10%">
                  <span>나만의 기준<strong>100%</strong></span>
                </div>
                <div className={styles.authPreviewLegend}>
                  <span><i />미국 지수 <b>35%</b></span>
                  <span><i />한국 지수 <b>25%</b></span>
                  <span><i />우량주 <b>20%</b></span>
                  <span><i />금·비트코인 <b>20%</b></span>
                </div>
              </div>
            </div>
            <a className={styles.authQuote} href="https://www.berkshirehathaway.com/letters/1988.html" target="_blank" rel="noreferrer">
              <span>“우리가 선호하는 보유 기간은 영원입니다.”</span>
              <small>워런 버핏 · 버크셔 해서웨이 1988 주주서한</small>
            </a>
          </div>
          <small>PERSONAL PORTFOLIO STUDIO</small>
        </section>
        <section className={styles.authForm}>
          <div>
            <span className={styles.kicker}>START WITH A PLAN</span>
            <h2>내 투자 기준을 세워보세요</h2>
            <p>보유 자산을 정리하고, 목표 비중에 맞는 투자 결정을 준비하세요.</p>
            <div className={styles.authSteps} aria-label="서비스 이용 순서">
              <span><b>01</b>목표 설계</span>
              <span><b>02</b>종목 연결</span>
              <span><b>03</b>비중 점검</span>
            </div>
            <small className={styles.authSignInLabel}>카카오 또는 네이버 계정으로 시작</small>
            <button
              className={styles.kakao}
              onClick={() => signIn("kakao", { callbackUrl: "/" })}
            >
              <b>K</b> 카카오로 계속하기 <ArrowRight size={17} />
            </button>
            <button
              className={styles.naver}
              onClick={() => signIn("naver", { callbackUrl: "/" })}
            >
              <b>N</b> 네이버로 계속하기 <ArrowRight size={17} />
            </button>
            <div className={styles.authPrivacy}>
              <ShieldCheck size={18} /> 캡처 이미지는 브라우저에서 분석하고
              저장하지 않습니다.
            </div>
          </div>
        </section>
      </div>
    );

  const nav = [
    { id: "portfolio" as View, label: "내 포트폴리오", Icon: LayoutDashboard },
    { id: "overview" as View, label: "자산 현황", Icon: Wallet },
    { id: "holdings" as View, label: "보유 자산", Icon: Wallet },
    { id: "import" as View, label: "캡처 가져오기", Icon: Camera },
    { id: "settings" as View, label: "계정", Icon: Settings2 },
  ];
  const navLabel = nav.find((item) => item.id === view)?.label;

  return (
    <div className={styles.shell}>
      {menuOpen && (
        <button
          className={styles.backdrop}
          aria-label="메뉴 닫기"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.brand}>
          <span className={styles.logo}>P</span>
          <div>
            <strong>PORTFOLIO</strong>
            <small>PERSONAL FINANCE</small>
          </div>
        </div>
        <div className={styles.navGroup}>
          <span>WORKSPACE</span>
          {nav.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={view === id ? styles.navActive : ""}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              {label}
              {view === id && <i />}
            </button>
          ))}
        </div>
        <div className={styles.sideFoot}>
          <div className={styles.sideNote}>
            <ShieldCheck size={18} />
            <span>
              개인 자산 공간<small>계정별로 분리해 보관 중</small>
            </span>
          </div>
          <a className={styles.sideQuote} href="https://www.berkshirehathaway.com/letters/2013ltr.pdf" target="_blank" rel="noreferrer">
            <span>“가격은 지불하는 것, 가치는 얻는 것.”</span>
            <small>벤저민 그레이엄</small>
          </a>
          <button className={styles.sideUser} onClick={() => go("settings")}>
            <span className={styles.avatar}>
              {session.user?.name?.slice(0, 1) || "P"}
            </span>
            <span>
              {session.user?.name || "내 계정"}
              <small>계정 관리</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <button
            className={styles.menuButton}
            aria-label="메뉴 열기"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={21} />
          </button>
          <div>
            내 자산 <span>/</span> <strong>{navLabel}</strong>
          </div>
          <span className={styles.topPrivate}>
            <ShieldCheck size={15} /> 개인 자산
          </span>
          <button className={styles.topAvatar} onClick={() => go("settings")}>
            {session.user?.name?.slice(0, 1) || "P"}
          </button>
        </header>
        <main className={styles.content}>
          {notice && (
            <div className={styles.notice} role="status">
              <CircleHelp size={17} />
              <span>{notice}</span>
              <button aria-label="알림 닫기" onClick={() => setNotice("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {legacy.length > 0 && (
            <div className={styles.legacyNotice}>
              <Wallet size={19} />
              <span>
                이 브라우저에 저장된 기존 자산 {legacy.length}개가 있습니다.
                계정으로 옮기면 다른 브라우저에서도 볼 수 있습니다.
              </span>
              <button disabled={busy} onClick={migrateLegacy}>
                계정으로 이전 <ArrowRight size={15} />
              </button>
            </div>
          )}
          {view === "portfolio" && (
            <PortfolioBuilder
              holdings={holdings}
              quoteVersion={quoteVersion}
              onHoldings={setHoldings}
              onNotice={setNotice}
              onRefreshQuotes={refreshQuotes}
              onImport={() => go("import")}
            />
          )}
          {view === "overview" && (
            <>
              <div className={styles.pageHead}>
                <div>
                  <span className={styles.kicker}>OVERVIEW</span>
                  <h1>내 자산 현황</h1>
                  <p>여러 증권사의 보유 자산을 한곳에서 확인하세요.</p>
                </div>
                <button
                  className={styles.secondaryButton}
                  onClick={refreshQuotes}
                  disabled={quoteBusy || !holdings.length}
                >
                  <RefreshCw size={17} />{" "}
                  {quoteBusy ? "조회 중" : "시세 새로고침"}
                </button>
              </div>
              <section className={styles.hero}>
                <div className={styles.heroArt} />
                <div className={styles.heroLabel}>
                  <Wallet size={19} /> 국내 주식 평가금액 <span>KRW</span>
                </div>
                <strong>
                  {won.format(totals.KR)}
                  <small>원</small>
                </strong>
                <div className={styles.heroBottom}>
                  <span>
                    {totals.costKnown.KR
                      ? `국내 평가손익 ${signedMoney(totals.gain.KR, "KR")} · `
                      : ""}
                    {brokers.length}개 증권사 · {holdings.length}개 보유 항목
                  </span>
                  <button onClick={() => go("holdings")}>
                    자세히 보기 <ArrowRight size={16} />
                  </button>
                </div>
              </section>
              <div className={styles.metrics}>
                <article>
                  <span className={styles.metricIcon}>$</span>
                  <p>미국 주식 평가금액</p>
                  <strong>$ {dollars.format(totals.US)}</strong>
                  <small>
                    {totals.costKnown.US
                      ? `평가손익 ${signedMoney(totals.gain.US, "US")} · `
                      : ""}
                    USD · 환율 변환 전
                  </small>
                </article>
                <article>
                  <span className={styles.metricIcon}>
                    <RefreshCw size={18} />
                  </span>
                  <p>가격 조회 완료</p>
                  <strong>
                    {totals.quoted}
                    <em> / {holdings.length}</em>
                  </strong>
                  <small>조회 실패 시 캡처 가격 사용</small>
                </article>
              </div>
              <div className={styles.dashboardGrid}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <span className={styles.kicker}>POSITIONS</span>
                      <h2>보유 종목</h2>
                    </div>
                    <button
                      className={styles.linkButton}
                      onClick={() => go("holdings")}
                    >
                      전체 보기 <ArrowRight size={16} />
                    </button>
                  </div>
                  {holdings.length ? (
                    <div className={styles.miniList}>
                      {holdings.slice(0, 5).map((row) => (
                        <div className={styles.miniRow} key={row.id}>
                          <span className={styles.assetIcon}>{row.market}</span>
                          <div>
                            <strong>{row.name}</strong>
                            <small>
                              {row.broker} · {row.symbol || "코드 미확인"}
                            </small>
                          </div>
                          <div>
                            <strong>{money(valueOf(row), row.market)}</strong>
                            <small>{won.format(row.quantity)}주</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty onImport={() => go("import")} loading={loading} />
                  )}
                </section>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <div>
                      <span className={styles.kicker}>BROKERAGES</span>
                      <h2>증권사별 자산</h2>
                    </div>
                    <span className={styles.pill}>{brokers.length}곳</span>
                  </div>
                  {brokers.length ? (
                    <div className={styles.brokerList}>
                      {brokers.map(([name, value]) => (
                        <div className={styles.brokerRow} key={name}>
                          <span>{name.slice(0, 1)}</span>
                          <div>
                            <strong>{name}</strong>
                            <small>{value.count}개 종목</small>
                          </div>
                          <div>
                            <strong>{money(value.KR, "KR")}</strong>
                            <small>{money(value.US, "US")}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.muted}>
                      캡처를 가져오면 증권사별 내역이 표시됩니다.
                    </p>
                  )}
                  <div className={styles.panelNote}>
                    <ShieldCheck size={16} /> 원화와 달러는 서로 합산하지
                    않습니다.
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "holdings" && (
            <>
              <div className={styles.pageHead}>
                <div>
                  <span className={styles.kicker}>MY ASSETS</span>
                  <h1>보유 자산</h1>
                  <p>확인한 종목과 가격 출처를 함께 보여드립니다.</p>
                </div>
                <button
                  className={styles.primaryButton}
                  onClick={() => go("import")}
                >
                  <Plus size={17} /> 자산 추가
                </button>
              </div>
              <div className={styles.holdingStats}>
                <div>
                  <span>국내 평가금액</span>
                  <strong>{money(totals.KR, "KR")}</strong>
                </div>
                <div>
                  <span>국내 평가손익</span>
                  <strong
                    className={
                      totals.gain.KR >= 0
                        ? styles.gainPositive
                        : styles.gainNegative
                    }
                  >
                    {totals.costKnown.KR
                      ? signedMoney(totals.gain.KR, "KR")
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>미국 평가금액</span>
                  <strong>{money(totals.US, "US")}</strong>
                </div>
                <div>
                  <span>미국 평가손익</span>
                  <strong
                    className={
                      totals.gain.US >= 0
                        ? styles.gainPositive
                        : styles.gainNegative
                    }
                  >
                    {totals.costKnown.US
                      ? signedMoney(totals.gain.US, "US")
                      : "—"}
                  </strong>
                </div>
              </div>
              <section className={styles.panel}>
                <div className={styles.toolbar}>
                  <div className={styles.tabs}>
                    {(["ALL", "KR", "US"] as const).map((item) => (
                      <button
                        key={item}
                        className={filter === item ? styles.tabActive : ""}
                        onClick={() => setFilter(item)}
                      >
                        {item === "ALL"
                          ? "전체"
                          : item === "KR"
                            ? "국내"
                            : "미국"}
                      </button>
                    ))}
                  </div>
                  <label className={styles.search}>
                    <Search size={17} />
                    <input
                      aria-label="종목 검색"
                      placeholder="종목명, 코드, 증권사 검색"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                </div>
                <div className={styles.tableHead}>
                  <span>종목</span>
                  <span>보유 수량</span>
                  <span>가격</span>
                  <span>평가 금액</span>
                  <span>평가손익</span>
                  <span />
                </div>
                {shown.length ? (
                  shown.map((row) => {
                    const price = row.currentPrice ?? row.capturedPrice;
                    return (
                      <div className={styles.holdingRow} key={row.id}>
                        <div className={styles.holdingName}>
                          <span className={styles.assetIcon}>{row.market}</span>
                          <div>
                            <strong>{row.name}</strong>
                            <small>
                              {row.broker} · {row.account} ·{" "}
                              {row.symbol || "코드 미확인"}
                            </small>
                            <button
                              type="button"
                              className={styles.savedCodeButton}
                              disabled={savedResolvingId === row.id}
                              onClick={() => resolveSavedInstrument(row)}
                            >
                              {savedResolvingId === row.id
                                ? "확인 중"
                                : "KIS 코드 확인"}
                            </button>
                            {savedInstrumentMatches[row.id]?.length ? (
                              <select
                                className={styles.savedInstrumentSelect}
                                defaultValue=""
                                aria-label={`${row.name} 종목 코드 후보`}
                                onChange={(event) => {
                                  const item = savedInstrumentMatches[
                                    row.id
                                  ].find(
                                    (candidate) =>
                                      `${candidate.symbol}|${candidate.exchange}` ===
                                      event.target.value,
                                  );
                                  if (item) applySavedInstrument(row, item);
                                }}
                              >
                                <option value="">후보를 선택하세요</option>
                                {savedInstrumentMatches[row.id].map((item) => (
                                  <option
                                    key={`${item.symbol}|${item.exchange}`}
                                    value={`${item.symbol}|${item.exchange}`}
                                  >
                                    {item.name} · {item.symbol} ({item.exchange}
                                    )
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </div>
                        </div>
                        <div>
                          <label>수량</label>
                          {won.format(row.quantity)}주
                        </div>
                        <div>
                          <label>가격</label>
                          {price === null ? "—" : money(price, row.market)}
                          <small>
                            {row.currentPrice === null
                              ? "캡처 기준"
                              : row.quoteLabel}
                          </small>
                        </div>
                        <strong>
                          <label>평가</label>
                          {price === null
                            ? "—"
                            : money(valueOf(row), row.market)}
                        </strong>
                        <strong
                          className={
                            gainOf(row) === null
                              ? ""
                              : gainOf(row)! >= 0
                                ? styles.gainPositive
                                : styles.gainNegative
                          }
                        >
                          <label>손익</label>
                          {gainOf(row) === null
                            ? "—"
                            : signedMoney(gainOf(row)!, row.market)}
                        </strong>
                        <button
                          className={styles.deleteButton}
                          aria-label={`${row.name} 삭제`}
                          onClick={() => removeHolding(row.id)}
                        >
                          <X size={18} />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <Empty onImport={() => go("import")} loading={loading} />
                )}
              </section>
              <p className={styles.footnote}>
                시세 조회 시각은 거래소 체결 시각과 다를 수 있습니다.
                {totals.costKnown.KR + totals.costKnown.US < holdings.length
                  ? ` 매입단가가 없는 종목은 손익 계산에서 제외됩니다.`
                  : ""}
                {totals.missing
                  ? ` 가격이 없는 ${totals.missing}개 종목은 평가금액에서 제외됩니다.`
                  : ""}
              </p>
            </>
          )}
          {view === "import" && (
            <>
              <div className={styles.pageHead}>
                <div>
                  <span className={styles.kicker}>ADD ASSETS</span>
                  <h1>캡처에서 자산 가져오기</h1>
                  <p>잔고 화면을 읽고, 확인한 내용만 계정에 저장합니다.</p>
                </div>
              </div>
              <div className={styles.importGrid}>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <h2>
                      <span className={styles.step}>01</span> 화면 선택
                    </h2>
                  </div>
                  <div className={styles.formGrid}>
                    <label>
                      증권사
                      <input
                        value={broker}
                        onChange={(event) => setBroker(event.target.value)}
                      />
                    </label>
                    <label>
                      계좌 구분
                      <input
                        value={account}
                        onChange={(event) => setAccount(event.target.value)}
                      />
                    </label>
                    <label>
                      잔고 화면
                      <select
                        value={market}
                        onChange={(event) =>
                          setMarket(event.target.value as Market)
                        }
                      >
                        <option value="KR">국내주식</option>
                        <option value="US">해외주식</option>
                      </select>
                    </label>
                  </div>
                  <p className={styles.formTip}>
                    미래에셋 종합잔고는 국내주식으로 자동 인식합니다.
                  </p>
                </section>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <h2>
                      <span className={styles.step}>02</span> 캡처 업로드
                    </h2>
                  </div>
                  <label className={styles.upload}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={importCapture}
                      disabled={busy}
                    />
                    <span>
                      <Camera size={27} />
                    </span>
                    <strong>
                      {busy
                        ? "이미지를 분석하고 있습니다"
                        : "이미지를 선택해 주세요"}
                    </strong>
                    <small>PNG, JPG 등 잔고 화면 캡처</small>
                    <em>
                      <FileUp size={16} /> 파일 선택
                    </em>
                  </label>
                  <p className={styles.formTip}>
                    <ShieldCheck size={15} /> 이미지는 브라우저에서만
                    분석합니다.
                  </p>
                </section>
              </div>
              <section className={styles.panel}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>
                      <span className={styles.step}>03</span> 내용 확인
                    </h2>
                    <p>
                      {captureName ||
                        "잘린 종목명과 코드를 확인한 뒤 저장하세요."}
                    </p>
                  </div>
                  <button
                    className={styles.secondaryButton}
                    onClick={() =>
                      setDraft((rows) => [
                        ...rows,
                        {
                          market,
                          name: "",
                          symbol: "",
                          exchange: null,
                          quantity: 0,
                          capturedPrice: null,
                          averageCost: null,
                        },
                      ])
                    }
                  >
                    <Plus size={17} /> 직접 추가
                  </button>
                </div>
                {draft.length ? (
                  <>
                    <div className={styles.reviewList}>
                      {draft.map((row, index) => (
                        <div className={styles.reviewRow} key={index}>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <label>
                            종목명
                            <input
                              value={row.name}
                              onChange={(event) =>
                                editDraft(index, "name", event.target.value)
                              }
                            />
                          </label>
                          <label>
                            종목 코드
                            <input
                              value={row.symbol}
                              onChange={(event) =>
                                editDraft(
                                  index,
                                  "symbol",
                                  event.target.value.toUpperCase(),
                                )
                              }
                              placeholder={
                                row.market === "KR"
                                  ? "6자리 코드 (예: 0167A0)"
                                  : "예: GOOGL"
                              }
                            />
                            <button
                              type="button"
                              className={styles.findCodeButton}
                              disabled={resolvingIndex === index}
                              onClick={() => resolveInstrument(index)}
                            >
                              <Search size={13} />
                              {resolvingIndex === index
                                ? "찾는 중"
                                : "KIS 코드 찾기"}
                            </button>
                            {instrumentMatches[index]?.length ? (
                              <select
                                className={styles.instrumentSelect}
                                defaultValue=""
                                onChange={(event) => {
                                  const item = instrumentMatches[index].find(
                                    (candidate) =>
                                      `${candidate.symbol}|${candidate.exchange}` ===
                                      event.target.value,
                                  );
                                  if (item) useInstrument(index, item);
                                }}
                              >
                                <option value="">후보를 선택하세요</option>
                                {instrumentMatches[index].map((item) => (
                                  <option
                                    key={`${item.symbol}|${item.exchange}`}
                                    value={`${item.symbol}|${item.exchange}`}
                                  >
                                    {item.name} · {item.symbol}
                                    {item.exchange ? ` (${item.exchange})` : ""}
                                  </option>
                                ))}
                              </select>
                            ) : null}
                          </label>
                          <label>
                            수량
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.quantity}
                              onChange={(event) =>
                                editDraft(index, "quantity", event.target.value)
                              }
                            />
                          </label>
                          <label>
                            캡처 가격
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.capturedPrice ?? ""}
                              onChange={(event) =>
                                editDraft(
                                  index,
                                  "capturedPrice",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <label>
                            매입 단가
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.averageCost ?? ""}
                              onChange={(event) =>
                                editDraft(
                                  index,
                                  "averageCost",
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                          <button
                            className={styles.deleteButton}
                            aria-label={`${index + 1}번째 종목 제외`}
                            onClick={() =>
                              setDraft((rows) =>
                                rows.filter(
                                  (_, position) => position !== index,
                                ),
                              )
                            }
                          >
                            <X size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className={styles.reviewFoot}>
                      <span>
                        <Check size={16} /> {draft.length}개 항목 검토 중
                      </span>
                      <button
                        className={styles.primaryButton}
                        disabled={busy}
                        onClick={saveDraft}
                      >
                        확인하고 저장 <ArrowRight size={17} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.reviewEmpty}>
                    <Camera size={27} />
                    <strong>확인할 종목이 없습니다</strong>
                    <span>캡처를 업로드하거나 직접 추가하세요.</span>
                  </div>
                )}
              </section>
            </>
          )}
          {view === "settings" && (
            <>
              <div className={styles.pageHead}>
                <div>
                  <span className={styles.kicker}>ACCOUNT</span>
                  <h1>내 계정</h1>
                  <p>로그인 계정과 자산 보관 방식을 확인하세요.</p>
                </div>
              </div>
              <div className={styles.settingsGrid}>
                <section className={styles.panel}>
                  <div className={styles.profile}>
                    <span className={styles.avatar}>
                      {session.user?.name?.slice(0, 1) || "P"}
                    </span>
                    <div>
                      <strong>{session.user?.name || "내 계정"}</strong>
                      <small>
                        {session.user?.email || "카카오 · 네이버 로그인"}
                      </small>
                    </div>
                  </div>
                  <div className={styles.settingRow}>
                    <span>보유 종목</span>
                    <strong>{holdings.length}개</strong>
                  </div>
                  <div className={styles.settingRow}>
                    <span>연결된 증권사</span>
                    <strong>{brokers.length}곳</strong>
                  </div>
                  <div className={styles.settingRow}>
                    <span>데이터 보관</span>
                    <strong>Supabase PostgreSQL</strong>
                  </div>
                  <button
                    className={styles.signOut}
                    onClick={() => signOut({ callbackUrl: "/" })}
                  >
                    <LogOut size={17} /> 로그아웃
                  </button>
                </section>
                <section className={styles.panel}>
                  <div className={styles.panelHead}>
                    <h2>데이터와 개인정보</h2>
                  </div>
                  <div className={styles.privacyItem}>
                    <ShieldCheck size={20} />
                    <div>
                      <strong>계정별 데이터 분리</strong>
                      <p>
                        로그인한 사용자에게 연결된 자산 내역만 서버가
                        조회합니다.
                      </p>
                    </div>
                  </div>
                  <div className={styles.privacyItem}>
                    <Camera size={20} />
                    <div>
                      <strong>캡처 이미지는 저장하지 않음</strong>
                      <p>
                        브라우저에서 인식한 뒤 확인한 종목 데이터만 저장합니다.
                      </p>
                    </div>
                  </div>
                  <div className={styles.privacyItem}>
                    <RefreshCw size={20} />
                    <div>
                      <strong>시세 출처 구분</strong>
                      <p>
                        시세 조회에 실패하면 캡처 가격을 사용하고 출처를
                        표시합니다.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
        <footer className={styles.footer}>
          PORTFOLIO · 개인 자산 관리를 위한 공간
        </footer>
      </div>
      <nav className={styles.mobileNav}>
        {nav.slice(0, 4).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={view === id ? styles.mobileActive : ""}
            onClick={() => go(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Empty({
  onImport,
  loading,
}: {
  onImport: () => void;
  loading: boolean;
}) {
  return (
    <div className={styles.empty}>
      <span>
        <Wallet size={25} />
      </span>
      <strong>
        {loading ? "자산을 불러오는 중입니다" : "아직 보유 자산이 없습니다"}
      </strong>
      <p>증권사 잔고 캡처에서 종목을 가져와 보세요.</p>
      {!loading && (
        <button onClick={onImport}>
          캡처 가져오기 <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
