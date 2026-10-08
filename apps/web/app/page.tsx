"use client";

import {
  ChangeEvent,
  FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  FileUp,
  LayoutDashboard,
  Menu,
  Moon,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import {
  Holding,
  Market,
  RecognizedHolding,
  recognizeHoldings,
} from "./holdings";
import PortfolioBuilder, { stockAssetId, type AssetSelection } from "./PortfolioBuilder";
import AssetIcon from "./AssetIcon";
import UserGuide from "./UserGuide";
import AccountSettings from "./AccountSettings";
import styles from "./page.module.css";

type View =
  | "portfolio"
  | "holdings"
  | "edit"
  | "strategy"
  | "composition"
  | "allocation"
  | "rebalance"
  | "history"
  | "import"
  | "more"
  | "detail"
  | "settings"
  | "guide";
const VIEWS: readonly View[] = [
  "portfolio", "holdings", "edit", "strategy", "composition", "allocation",
  "rebalance", "history", "import", "more", "detail", "settings", "guide",
];

function screenUrl(next: View, asset: AssetSelection | null, source: string) {
  const url = new URL(window.location.href);
  if (next === "portfolio") url.searchParams.delete("view");
  else url.searchParams.set("view", next);
  for (const key of ["asset", "kind", "source"]) url.searchParams.delete(key);
  if (next === "detail" && asset) {
    url.searchParams.set("asset", asset.id);
    url.searchParams.set("kind", asset.kind);
    url.searchParams.set("source", source);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
type Instrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string | null;
};
type DailyStockQuote = {
  market: Market;
  symbol: string;
  exchange: string | null;
  previousClose: number | null;
  checkedAt: string | null;
};
type DailyCryptoQuotes = Record<
  string,
  { previousClose: number | null; checkedAt: string | null }
>;
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
const gainPercentOf = (row: Holding) =>
  gainOf(row) === null || !row.averageCost || row.quantity <= 0
    ? null
    : (gainOf(row)! / (row.quantity * row.averageCost)) * 100;
const signedPercent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const signedMoney = (value: number, market: Market) =>
  `${value > 0 ? "+" : ""}${money(value, market)}`;

async function data<T>(response: Response): Promise<T> {
  const result = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(result.message || "요청에 실패했습니다.");
  return result;
}

export default function PortfolioPage() {
  const { data: session, status: authStatus } = useSession();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setView] = useState<View>("portfolio");
  const [showStartGuide, setShowStartGuide] = useState(false);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    try {
      setShowStartGuide(localStorage.getItem(`pf-guide-dismissed:${session?.user?.appUserId ?? "account"}`) !== "1");
    } catch { setShowStartGuide(true); }
  }, [authStatus, session?.user?.appUserId]);

  function dismissStartGuide() {
    setShowStartGuide(false);
    try { localStorage.setItem(`pf-guide-dismissed:${session?.user?.appUserId ?? "account"}`, "1"); } catch { /* Dismiss for this visit when storage is unavailable. */ }
  }
  const [selectedAsset, setSelectedAsset] = useState<AssetSelection | null>(null);
  const [detailSource, setDetailSource] = useState<"portfolio" | "holdings">("portfolio");
  const [editFocus, setEditFocus] = useState<AssetSelection | null>(null);
  const [portfolioDirty, setPortfolioDirty] = useState(false);
  const navigationState = useRef({ dirty: false, url: "" });

  useEffect(() => {
    navigationState.current.dirty = portfolioDirty;
  }, [portfolioDirty]);

  useEffect(() => {
    function restoreScreen() {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("view") as View;
      let next: View = VIEWS.includes(requested) ? requested : "portfolio";
      const id = params.get("asset");
      const kind = params.get("kind");
      const asset: AssetSelection | null = id && (kind === "stock" || kind === "crypto" || kind === "manual")
        ? { id, kind } : null;
      if (next === "detail" && !asset) next = "holdings";
      setSelectedAsset(asset);
      setDetailSource(params.get("source") === "holdings" ? "holdings" : "portfolio");
      setView(next);
      setEditFocus(null);
      setEditingHoldingId(null);
      setNotice("");
      navigationState.current.url = window.location.href;
    }
    function onHistoryChange() {
      if (navigationState.current.dirty && !window.confirm("저장하지 않은 포트폴리오 변경 사항을 버리고 이동할까요?")) {
        window.history.pushState(null, "", navigationState.current.url);
        return;
      }
      navigationState.current.dirty = false;
      setPortfolioDirty(false);
      restoreScreen();
    }
    restoreScreen();
    window.addEventListener("popstate", onHistoryChange);
    return () => window.removeEventListener("popstate", onHistoryChange);
  }, []);
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
  const [quoteError, setQuoteError] = useState("");
  const quoteInFlight = useRef(false);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [dailyStockQuotes, setDailyStockQuotes] = useState<DailyStockQuote[]>(
    [],
  );
  const [dailyCryptoQuotes, setDailyCryptoQuotes] = useState<DailyCryptoQuotes>(
    {},
  );
  const lastQuoteAttemptAt = useRef(0);
  const [filter, setFilter] = useState<"ALL" | Market>("ALL");
  const [search, setSearch] = useState("");
  const [legacy, setLegacy] = useState<Holding[]>([]);
  const [resolvingIndex, setResolvingIndex] = useState<number | null>(null);
  const [instrumentMatches, setInstrumentMatches] = useState<
    Record<number, Instrument[]>
  >({});
  const [savedInstrumentMatches, setSavedInstrumentMatches] = useState<
    Record<string, Instrument[]>
  >({});
  const [savedResolvingId, setSavedResolvingId] = useState<string | null>(null);
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null);
  const [holdingQuantity, setHoldingQuantity] = useState("");
  const [holdingCost, setHoldingCost] = useState("");
  const [holdingSaving, setHoldingSaving] = useState(false);
  const [localAdminOpen, setLocalAdminOpen] = useState(false);
  const [localAdminName, setLocalAdminName] = useState("");
  const [localAdminPassword, setLocalAdminPassword] = useState("");
  const [localAdminBusy, setLocalAdminBusy] = useState(false);
  const [localAdminError, setLocalAdminError] = useState("");

  async function signInLocalAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalAdminBusy(true);
    setLocalAdminError("");
    try {
      const result = await signIn("local-admin", {
        redirect: false,
        username: localAdminName,
        password: localAdminPassword,
        callbackUrl: "/",
      });
      setLocalAdminPassword("");
      if (!result?.ok) {
        setLocalAdminError("아이디 또는 비밀번호를 확인해 주세요.");
        return;
      }
      window.location.reload();
    } catch {
      setLocalAdminError("로컬 관리자 로그인에 실패했습니다.");
    } finally {
      setLocalAdminBusy(false);
    }
  }

  useEffect(() => {
    try {
      const saved =
        localStorage.getItem("pf-theme") === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = saved;
      setTheme(saved);
    } catch {
      document.documentElement.dataset.theme = "light";
      setTheme("light");
    }
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("pf-theme", next);
    } catch {
      // The switch still works when storage is unavailable.
    }
  }

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    try {
      const cached = JSON.parse(
        sessionStorage.getItem(
          `pf-daily-quotes:v2:${session?.user?.appUserId ?? "account"}`,
        ) ?? "null",
      ) as { savedAt: number; quotes: DailyStockQuote[] } | null;
      if (
        cached &&
        Date.now() - cached.savedAt < 5 * 60 * 1000 &&
        Array.isArray(cached.quotes)
      )
        setDailyStockQuotes(cached.quotes);
    } catch {
      // Fresh quotes will be fetched when session storage is unavailable.
    }
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
            sum.cost[row.market] += row.quantity * row.averageCost!;
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
          cost: { KR: 0, US: 0 },
          costKnown: { KR: 0, US: 0 },
        },
      ),
    [holdings],
  );

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

  function go(next: View, asset = selectedAsset, source = detailSource) {
    if (
      portfolioDirty &&
      next !== view &&
      !window.confirm("저장하지 않은 포트폴리오 변경 사항을 버리고 이동할까요?")
    )
      return;
    if (next !== view) setPortfolioDirty(false);
    if (next !== "edit") {
      setEditFocus(null);
      setEditingHoldingId(null);
    }
    setView(next);
    const url = screenUrl(next, asset, source);
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.pushState(null, "", url);
    }
    navigationState.current.url = window.location.href;
    if (next !== view) navigationState.current.dirty = false;
    if (next !== view) window.scrollTo({ top: 0, behavior: "instant" });
    setNotice("");
  }

  function openAsset(asset: AssetSelection, source: "portfolio" | "holdings") {
    setSelectedAsset(asset);
    setDetailSource(source);
    go("detail", asset, source);
  }


  useEffect(() => {
    if (view !== "edit" || !editingHoldingId) return;
    requestAnimationFrame(() => document.getElementById(`edit-stock-${editingHoldingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [view, editingHoldingId]);

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

  function beginHoldingEdit(row: Holding) {
    setEditingHoldingId(row.id);
    setHoldingQuantity(String(row.quantity));
    setHoldingCost(row.averageCost === null ? "" : String(row.averageCost));
  }

  async function saveHoldingAmounts() {
    if (!editingHoldingId) return;
    const quantity = Number(holdingQuantity);
    const averageCost = holdingCost.trim() === "" ? null : Number(holdingCost);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      Math.abs(quantity - Math.round(quantity * 1e6) / 1e6) > 1e-9 ||
      (averageCost !== null &&
        (!Number.isFinite(averageCost) || averageCost <= 0))
    )
      return setNotice(
        "수량은 소수점 6자리까지, 매입단가는 양수로 입력해 주세요.",
      );
    setHoldingSaving(true);
    try {
      const result = await data<{ holdings: Holding[] }>(
        await fetch("/api/holdings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingHoldingId, quantity, averageCost }),
        }),
      );
      setHoldings(result.holdings);
      setQuoteVersion((version) => version + 1);
      setEditingHoldingId(null);
      setNotice("보유 수량과 매입단가를 저장했습니다.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "자산을 수정하지 못했습니다.",
      );
    } finally {
      setHoldingSaving(false);
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
      go("holdings");
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

  async function refreshQuotes(silent = false) {
    if (quoteInFlight.current) return;
    quoteInFlight.current = true;
    lastQuoteAttemptAt.current = Date.now();
    try {
      sessionStorage.setItem(
        `pf-quote-refresh:${session?.user?.appUserId ?? "account"}`,
        String(Date.now()),
      );
    } catch {
      // Private browsing may disable storage; the in-flight guard still applies.
    }
    setQuoteBusy(true);
    setQuoteError("");
    if (!silent) setNotice("시세를 조회하는 중입니다.");
    try {
      const result = await data<{
        holdings: Holding[];
        quotes: {
          market?: Market;
          symbol?: string;
          marketCode?: string;
          exchange?: string | null;
          price: number | null;
          previousClose?: number | null;
          checkedAt?: string | null;
          error?: string;
        }[];
      }>(await fetch("/api/quotes", { method: "POST" }));
      setHoldings(result.holdings);
      const daily = result.quotes
        .filter(
          (quote): quote is typeof quote & { market: Market; symbol: string } =>
            (quote.market === "KR" || quote.market === "US") &&
            typeof quote.symbol === "string",
        )
        .map((quote) => ({
          market: quote.market,
          symbol: quote.symbol,
          exchange: quote.exchange ?? null,
          previousClose: quote.previousClose ?? null,
          checkedAt: quote.checkedAt ?? null,
        }));
      setDailyStockQuotes(daily);
      setDailyCryptoQuotes(
        Object.fromEntries(
          result.quotes
            .filter((quote) => typeof quote.marketCode === "string")
            .map((quote) => [
              quote.marketCode!,
              {
                previousClose: quote.previousClose ?? null,
                checkedAt: quote.checkedAt ?? null,
              },
            ]),
        ),
      );
      try {
        sessionStorage.setItem(
          `pf-daily-quotes:v2:${session?.user?.appUserId ?? "account"}`,
          JSON.stringify({ savedAt: Date.now(), quotes: daily }),
        );
      } catch {
        // A fresh API response is still available in memory.
      }
      setQuoteVersion((version) => version + 1);
      const count = result.quotes.filter(
        (quote) => quote.price !== null,
      ).length;
      const firstError = result.quotes.find((quote) => quote.error)?.error;
      if (firstError) setQuoteError(firstError);
      if (!silent)
        setNotice(
          `${count}개 자산의 시세를 갱신했습니다.${result.quotes.length > count ? ` ${result.quotes.length - count}개는 조회되지 않았습니다.` : ""}${firstError ? ` ${firstError}` : ""}`,
        );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "시세를 조회하지 못했습니다.";
      setQuoteError(message);
      if (!silent) setNotice(message);
    } finally {
      setQuoteBusy(false);
      quoteInFlight.current = false;
    }
  }

  useEffect(() => {
    if (
      authStatus !== "authenticated" ||
      !holdings.length ||
      (view !== "portfolio" && view !== "holdings")
    )
      return;
    const key = `pf-quote-refresh:${session?.user?.appUserId ?? "account"}`;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || quoteInFlight.current)
        return;
      const hasDailyQuotes = dailyStockQuotes.some(
        (quote) => quote.previousClose !== null,
      );
      let last = lastQuoteAttemptAt.current;
      try {
        if (hasDailyQuotes)
          last = Math.max(last, Number(sessionStorage.getItem(key) ?? 0));
      } catch {
        // Refresh still works when session storage is unavailable.
      }
      if (Date.now() - last < (hasDailyQuotes ? 5 : 1) * 60 * 1000) return;
      void refreshQuotes(true);
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [
    authStatus,
    holdings.length,
    session?.user?.appUserId,
    view,
    dailyStockQuotes,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <span className={styles.logo}>PR</span> PortRhythm을 준비하고 있습니다
      </div>
    );

  if (authStatus !== "authenticated")
    return (
      <div className={styles.authShell}>
        <section className={styles.authVisual}>
          <div className={styles.authBrand}>
            <span className={styles.logo}>PR</span> PortRhythm
          </div>
          <div className={styles.authPitch}>
            <span className={styles.kicker}>PORTRHYTHM · YOUR ALLOCATION</span>
            <h1>
              투자는 리듬을 타듯,
              <br />내 기준으로 꾸준히.
            </h1>
            <p>
              목표 비중을 직접 설계하고 국내·미국 종목을 연결하세요. 현재 비중과
              목표의 차이, 다음 조정이 필요한 자산까지 한눈에 볼 수 있습니다.
            </p>
            <div className={styles.authGraphic}>
              <div className={styles.authGraphicHead}>
                <span>PORTFOLIO BLUEPRINT</span>
                <strong>목표 비중 예시</strong>
              </div>
              <div className={styles.authGraphicBody}>
                <div
                  className={styles.authPreviewRing}
                  aria-label="미국 지수 35%, 한국 지수 25%, 우량주 20%, 금 10%, 비트코인 10%"
                >
                  <span>
                    나만의 기준<strong>100%</strong>
                  </span>
                </div>
                <div className={styles.authPreviewLegend}>
                  <span>
                    <i />
                    미국 지수 <b>35%</b>
                  </span>
                  <span>
                    <i />
                    한국 지수 <b>25%</b>
                  </span>
                  <span>
                    <i />
                    우량주 <b>20%</b>
                  </span>
                  <span>
                    <i />
                    금·비트코인 <b>20%</b>
                  </span>
                </div>
              </div>
            </div>
            <a
              className={styles.authQuote}
              href="https://www.berkshirehathaway.com/letters/1988.html"
              target="_blank"
              rel="noreferrer"
            >
              <span>“우리가 선호하는 보유 기간은 영원입니다.”</span>
              <small>워런 버핏 · 버크셔 해서웨이 1988 주주서한</small>
            </a>
          </div>
          <small>PORTRHYTHM · 나만의 투자 비중</small>
        </section>
        <section className={styles.authForm}>
          <div>
            <span className={styles.kicker}>START WITH A PLAN</span>
            <h2>내 투자 기준을 세워보세요</h2>
            <p>
              보유 자산을 정리하고, 목표 비중에 맞는 투자 결정을 준비하세요.
            </p>
            <div className={styles.authSteps} aria-label="서비스 이용 순서">
              <span>
                <b>01</b>목표 설계
              </span>
              <span>
                <b>02</b>종목 연결
              </span>
              <span>
                <b>03</b>비중 점검
              </span>
            </div>
            <small className={styles.authSignInLabel}>
              카카오 또는 네이버 계정으로 시작
            </small>
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
            {process.env.NODE_ENV === "development" && (
              <div className={styles.localAdminAccess}>
                <button
                  type="button"
                  className={styles.localAdminToggle}
                  onClick={() => setLocalAdminOpen((open) => !open)}
                  aria-expanded={localAdminOpen}
                >
                  로컬 관리자 테스트 로그인
                </button>
                {localAdminOpen && (
                  <form onSubmit={signInLocalAdmin}>
                    <label>
                      아이디
                      <input
                        autoComplete="username"
                        value={localAdminName}
                        onChange={(event) =>
                          setLocalAdminName(event.target.value)
                        }
                        required
                      />
                    </label>
                    <label>
                      비밀번호
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={localAdminPassword}
                        onChange={(event) =>
                          setLocalAdminPassword(event.target.value)
                        }
                        required
                      />
                    </label>
                    {localAdminError && <p role="alert">{localAdminError}</p>}
                    <button type="submit" disabled={localAdminBusy}>
                      {localAdminBusy
                        ? "로그인 중"
                        : "테스트 계정으로 들어가기"}
                    </button>
                  </form>
                )}
              </div>
            )}
            <a className={styles.authGuideLink} href="/guide">처음이신가요? 사용 가이드 보기 <ArrowRight size={16} /></a>
            <div className={styles.authPrivacy}>
              <ShieldCheck size={18} /> 캡처 이미지는 브라우저에서 분석하고
              저장하지 않습니다.
            </div>
          </div>
        </section>
      </div>
    );

  const nav = [
    { id: "portfolio" as View, label: "대시보드", Icon: LayoutDashboard },
    { id: "holdings" as View, label: "보유 자산", Icon: Wallet },
    { id: "edit" as View, label: "자산 수정", Icon: Pencil },
    { id: "strategy" as View, label: "목표 설계", Icon: Settings2 },
    { id: "composition" as View, label: "포트 비중", Icon: PieChart },
    { id: "allocation" as View, label: "자산 배정", Icon: Wallet },
    { id: "rebalance" as View, label: "리밸런싱", Icon: RefreshCw },
    { id: "history" as View, label: "자산 기록", Icon: LayoutDashboard },
    { id: "import" as View, label: "캡처 가져오기", Icon: Camera },
    { id: "settings" as View, label: "계정", Icon: Settings2 },
    { id: "guide" as View, label: "사용 가이드", Icon: CircleHelp },
  ];
  const navLabel = view === "more" ? "전체 메뉴" : view === "detail" ? "자산 상세" : nav.find((item) => item.id === view)?.label;
  const menuSections = [
    { label: "포트폴리오", ids: ["strategy", "composition", "rebalance"] },
    { label: "자산 관리", ids: ["holdings", "edit", "allocation", "import"] },
    { label: "기록과 계정", ids: ["history", "settings", "guide"] },
  ];
  const menuDescriptions: Partial<Record<View, string>> = {
    strategy: "목표 비중과 허용 오차 설정",
    composition: "현재 비중과 목표 비교",
    rebalance: "매수·매도 수량 확인",
    holdings: "종목별 평가액과 손익",
    edit: "수량, 매입단가, 자산 이름 수정",
    allocation: "보유 자산의 포트 지정",
    import: "증권사 잔고 캡처로 등록",
    history: "포트별 자산 변화 확인",
    settings: "계정·화면 설정과 이용 안내",
    guide: "처음 시작하는 순서와 기능 설명",
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.logo}>PR</span>
          <div>
            <strong>PortRhythm</strong>
            <small>투자는 리듬을 타듯</small>
          </div>
        </div>
        <div className={styles.navGroup}>
          {nav.map(({ id, label, Icon }, index) => (
            <Fragment key={id}>
              {index === 0 && <span>자산</span>}
              {index === 3 && <span>포트폴리오</span>}
              {index === 7 && <span>도구</span>}
              <button
                className={view === id ? styles.navActive : ""}
                onClick={() => go(id)}
              >
                <Icon size={19} />
                {label}
                {view === id && <i />}
              </button>
            </Fragment>
          ))}
        </div>
        <div className={styles.sideFoot}>
          <div className={styles.sideNote}>
            <ShieldCheck size={18} />
            <span>
              개인 자산 공간<small>계정별로 분리해 보관 중</small>
            </span>
          </div>
          <a
            className={styles.sideQuote}
            href="https://www.berkshirehathaway.com/letters/2013ltr.pdf"
            target="_blank"
            rel="noreferrer"
          >
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
      <div
        className={`${styles.workspace} ${view === "portfolio" ? styles.mobileHomeWorkspace : ""}`}
      >
        <header className={styles.topbar}>
          <button
            className={styles.mobileBrand}
            aria-label="PortRhythm 홈으로"
            onClick={() => go("portfolio")}
          >
            PR
          </button>
          <div>
            <span className={styles.desktopBreadcrumb}>내 자산 /</span> <strong>{navLabel}</strong>
          </div>
          <span className={styles.topPrivate}>
            <ShieldCheck size={15} /> 개인 자산
          </span>
          <button
            type="button"
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"
            }
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? "라이트 모드" : "다크 모드"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className={styles.topAvatar} onClick={() => go("settings")}>
            {session.user?.name?.slice(0, 1) || "P"}
          </button>
        </header>
        <main className={styles.content}>
          {view === "guide" && <UserGuide onNavigate={go} />}
          {view === "portfolio" && showStartGuide && (
            <section className={styles.startGuide} aria-label="처음 시작 안내">
              <CircleHelp size={21} />
              <div><strong>나만의 포트폴리오, 어디서 시작할까요?</strong><p>목표 설계 → 자산 등록 → 배정 → 비중 점검</p></div>
              <button type="button" onClick={() => go("guide")}>시작 안내 <ArrowRight size={16} /></button>
              <button type="button" className={styles.startGuideDismiss} aria-label="시작 안내 닫기" onClick={dismissStartGuide}><X size={17} /></button>
            </section>
          )}
          {view === "more" && (
            <div className={styles.allMenu}>
              <div className={styles.pageHead}>
                <div>
                  <h1>전체 메뉴</h1>
                  <p>내 투자 기준부터 자산 관리까지</p>
                </div>
              </div>
              {menuSections.map((section) => (
                <section className={styles.menuSection} key={section.label}>
                  <h2>{section.label}</h2>
                  {section.ids.map((id) => {
                    const item = nav.find((entry) => entry.id === id)!;
                    return (
                      <button key={id} type="button" onClick={() => go(item.id)}>
                        <item.Icon size={22} strokeWidth={1.7} />
                        <span><strong>{item.label}</strong><small>{menuDescriptions[item.id]}</small></span>
                        <ChevronRight size={17} />
                      </button>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
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
          {(
            [
              "portfolio",
              "strategy",
              "composition",
              "allocation",
              "rebalance",
              "history",
              "detail",
            ] as View[]
          ).includes(view) && (
            <PortfolioBuilder
              userId={session.user?.appUserId ?? "account"}
              screen={
                view === "portfolio"
                  ? "dashboard"
                  : (view as
                      | "strategy"
                      | "composition"
                      | "allocation"
                      | "rebalance"
                      | "history"
                      | "detail")
              }
              holdings={holdings}
              dailyStockQuotes={dailyStockQuotes}
              dailyCryptoQuotes={dailyCryptoQuotes}
              onDailyCryptoQuotes={setDailyCryptoQuotes}
              quoteVersion={quoteVersion}
              onHoldings={setHoldings}
              onNotice={setNotice}
              onRefreshQuotes={refreshQuotes}
              quotesRefreshing={quoteBusy}
              quoteError={quoteError}
              onImport={() => go("import")}
              onEditHoldings={() => go("edit")}
              selectedAsset={selectedAsset}
              onSelectAsset={(asset) => openAsset(asset, "portfolio")}
              onBack={() => go(detailSource)}
              onNavigate={go}
              onDirtyChange={setPortfolioDirty}
            />
          )}
          {(view === "holdings" || view === "edit") && (
            <>
              <div className={styles.pageHead}>
                <div>
                  <h1>{view === "edit" ? "자산 수정" : "보유 자산"}</h1>
                  <p>
                    {view === "edit"
                      ? "주식·가상자산·현금의 수량과 매입가를 한곳에서 관리하세요."
                      : "평가액, 손익률과 가격 출처를 함께 확인하세요."}
                  </p>
                </div>
                <button
                  className={styles.primaryButton}
                  onClick={() => go(view === "edit" ? "holdings" : "edit")}
                >
                  {view === "edit" ? "보유 자산으로" : "자산 수정"}{" "}
                  <ArrowRight size={17} />
                </button>
              </div>
              {view === "holdings" && (
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
                    {totals.cost.KR > 0 && (
                      <small
                        className={
                          totals.gain.KR >= 0
                            ? styles.gainPositive
                            : styles.gainNegative
                        }
                      >
                        {signedPercent((totals.gain.KR / totals.cost.KR) * 100)}
                      </small>
                    )}
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
                    {totals.cost.US > 0 && (
                      <small
                        className={
                          totals.gain.US >= 0
                            ? styles.gainPositive
                            : styles.gainNegative
                        }
                      >
                        {signedPercent((totals.gain.US / totals.cost.US) * 100)}
                      </small>
                    )}
                  </div>
                </div>
              )}
              {view === "edit" && (
                <div className={styles.editIntro}>
                  <strong>수정할 자산을 선택하세요</strong>
                  <span>
                    주식 수량과 매입단가를 수정하고, 아래에서 가상자산·직접 입력 자산의 이름과 금액을 관리하세요.
                  </span>
                  <button onClick={() => go("import")}>
                    새 자산 추가 <Plus size={15} />
                  </button>
                </div>
              )}
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
                      <Fragment key={row.id}>
                        <div className={styles.holdingRow} id={`edit-stock-${row.id}`}>
                          <div className={styles.holdingName}>
                            <AssetIcon
                              kind="stock"
                              symbol={row.symbol}
                              name={row.name}
                              market={row.market}
                              exchange={row.exchange}
                            />
                            <div>
                              {view === "holdings" ? (
                                <button type="button" className={styles.holdingDetailLink} onClick={() => openAsset({ kind: "stock", id: `holding:${row.id}` }, "holdings")}>
                                  {row.name} <ChevronRight size={15} />
                                </button>
                              ) : <strong>{row.name}</strong>}
                              <small>
                                {row.broker} · {row.account} ·{" "}
                                {row.symbol || "코드 미확인"}
                              </small>
                              {view === "edit" && (
                                <button
                                  type="button"
                                  className={styles.savedCodeButton}
                                  onClick={() => beginHoldingEdit(row)}
                                >
                                  <Pencil size={12} /> 이 종목 수정
                                </button>
                              )}
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
                            {gainPercentOf(row) !== null && (
                              <small className={styles.gainPercent}>
                                {signedPercent(gainPercentOf(row)!)}
                              </small>
                            )}
                          </strong>
                          {view === "edit" ? (
                            <button
                              className={styles.deleteButton}
                              aria-label={`${row.name} 삭제`}
                              onClick={() => removeHolding(row.id)}
                            >
                              <X size={18} />
                            </button>
                          ) : (
                            <span />
                          )}
                        </div>
                        {view === "edit" && editingHoldingId === row.id && (
                          <div className={styles.holdingEdit}>
                            <div className={styles.editTitle}>
                              <strong>{row.name}</strong>
                              <span>
                                {row.broker} · {row.account}
                              </span>
                            </div>
                            <label>
                              보유 수량
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={holdingQuantity}
                                onChange={(event) =>
                                  setHoldingQuantity(event.target.value)
                                }
                              />
                            </label>
                            <label>
                              주당 매입단가 (
                              {row.market === "US" ? "USD" : "KRW"})
                              <input
                                type="number"
                                min="0"
                                step="0.000001"
                                value={holdingCost}
                                onChange={(event) =>
                                  setHoldingCost(event.target.value)
                                }
                                placeholder="모르면 비워두기"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={saveHoldingAmounts}
                              disabled={holdingSaving}
                            >
                              {holdingSaving ? "저장 중" : "저장"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingHoldingId(null)}
                            >
                              취소
                            </button>
                            <div className={styles.codeVerification}>
                              <div>
                                <strong>
                                  종목코드 · {row.symbol || "미확인"}
                                </strong>
                                <span>
                                  한국투자증권 종목 마스터에서 코드와 거래소를
                                  확인합니다. 올바른 코드가 연결돼야 현재가를
                                  조회할 수 있습니다.
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={savedResolvingId === row.id}
                                onClick={() => resolveSavedInstrument(row)}
                              >
                                {savedResolvingId === row.id
                                  ? "조회 중"
                                  : "종목코드 확인·변경"}
                              </button>
                              {savedInstrumentMatches[row.id]?.length ? (
                                <select
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
                                  {savedInstrumentMatches[row.id].map(
                                    (item) => (
                                      <option
                                        key={`${item.symbol}|${item.exchange}`}
                                        value={`${item.symbol}|${item.exchange}`}
                                      >
                                        {item.name} · {item.symbol} (
                                        {item.exchange})
                                      </option>
                                    ),
                                  )}
                                </select>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <Empty onImport={() => go("import")} loading={loading} />
                )}
              </section>
              {view === "edit" && (
                <PortfolioBuilder
                  userId={session.user?.appUserId ?? "account"}
                  screen="edit"
                  holdings={holdings}
                  dailyStockQuotes={dailyStockQuotes}
                  dailyCryptoQuotes={dailyCryptoQuotes}
                  onDailyCryptoQuotes={setDailyCryptoQuotes}
                  quoteVersion={quoteVersion}
                  onHoldings={setHoldings}
                  onNotice={setNotice}
                  onRefreshQuotes={refreshQuotes}
                  quotesRefreshing={quoteBusy}
                  quoteError={quoteError}
                  onImport={() => go("import")}
                  onEditHoldings={() => go("edit")}
                  selectedAsset={selectedAsset}
                  onSelectAsset={(asset) => openAsset(asset, "portfolio")}
                      onBack={() => go(detailSource)}
                  focusAsset={editFocus}
                  onNavigate={go}
                  onDirtyChange={setPortfolioDirty}
                />
              )}
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
            <AccountSettings
              name={session.user?.name}
              email={session.user?.email}
              theme={theme}
              onThemeChange={(next) => { if (next !== theme) toggleTheme(); }}
              onNavigate={go}
              onSignOut={() => signOut({ callbackUrl: "/" })}
            />
          )}
        </main>
      </div>
      <nav
        className={`${styles.mobileNav} ${view === "portfolio" ? styles.mobileHomeNav : ""}`}
        aria-label="모바일 주요 메뉴"
      >
        {(["portfolio", "composition", "rebalance"] as View[]).map((id) => {
          const item = nav.find((entry) => entry.id === id)!;
          const { Icon } = item;
          const label =
            id === "portfolio"
              ? "자산"
              : id === "composition"
                ? "비중"
                : "리밸런싱";
          return (
            <button
              key={id}
              className={view === id ? styles.mobileActive : ""}
              onClick={() => go(id)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          );
        })}
        <button className={view === "more" ? styles.mobileActive : ""} onClick={() => go("more")} aria-label="전체 메뉴">
          <Menu size={21} />
          <span>전체</span>
        </button>
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
