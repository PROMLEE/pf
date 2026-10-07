"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Plus,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { Holding, Market } from "./holdings";
import AssetIcon from "./AssetIcon";
import Portfolio3D from "./Portfolio3D";
import PortfolioVisuals from "./PortfolioVisuals";
import {
  EXAMPLE_BUCKETS,
  EXAMPLE_RULES,
  cryptoAssetValueKrw,
  holdingValueKrw,
  manualAssetValueKrw,
  portfolioValues,
  type Bucket,
  type Portfolio,
  type Rule,
} from "./portfolio-model";
import { needsAdjustment, rebalance } from "./rebalance";
import styles from "./portfolio.module.css";

type Candidate = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string | null;
};
type CryptoMarket = { marketCode: string; name: string; englishName: string };
const portfolioCache = new Map<string, Portfolio | null>();
type DailyCryptoQuotes = Record<
  string,
  { previousClose: number | null; checkedAt: string | null }
>;
export type AssetSelection = {
  kind: "stock" | "crypto" | "manual";
  id: string;
};
export function stockAssetId(holding: Holding) {
  return holding.symbol
    ? `${holding.market}:${holding.exchange ?? ""}:${holding.symbol.toUpperCase()}`
    : `holding:${holding.id}`;
}
type Props = {
  userId: string;
  screen:
    | "dashboard"
    | "strategy"
    | "composition"
    | "allocation"
    | "edit"
    | "rebalance"
    | "history"
    | "detail";
  holdings: Holding[];
  dailyStockQuotes: {
    market: Market;
    symbol: string;
    exchange: string | null;
    previousClose: number | null;
    checkedAt: string | null;
  }[];
  dailyCryptoQuotes: DailyCryptoQuotes;
  onDailyCryptoQuotes: (quotes: DailyCryptoQuotes) => void;
  quoteVersion: number;
  onHoldings: (rows: Holding[]) => void;
  onNotice: (message: string) => void;
  onRefreshQuotes: () => Promise<void>;
  quotesRefreshing: boolean;
  quoteError: string;
  onImport: () => void;
  onEditHoldings: () => void;
  selectedAsset?: AssetSelection | null;
  focusAsset?: AssetSelection | null;
  onSelectAsset?: (asset: AssetSelection) => void;
  onEditAsset?: (asset: AssetSelection) => void;
  onBack?: () => void;
  onNavigate: (
    screen: "strategy" | "allocation" | "rebalance" | "history",
  ) => void;
  onDirtyChange: (dirty: boolean) => void;
};
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const quantityFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 8,
});
const fmt = (value: number) => `${won.format(value)}원`;
const pct = (value: number) => `${value.toFixed(1)}%`;
const kstDate = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const timeLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(value))
    : "확인 안 됨";
const colors = [
  "#177C88",
  "#42A994",
  "#6986B3",
  "#CBA664",
  "#D88975",
  "#9D7FA8",
  "#618F9F",
];

function emptyPortfolio(): Portfolio {
  return {
    title: "나의 투자 포트폴리오",
    usdKrw: 1400,
    usdKrwUpdatedAt: null,
    usdKrwMode: "auto",
    usdKrwRateDate: null,
    tolerancePercent: 5,
    buckets: [],
    rules: [],
    manualAssets: [],
    cryptoAssets: [],
    assignments: [],
    snapshots: [],
    cashFlows: [],
  };
}

function Trend({
  points,
  color,
}: {
  points: { date: string; value: number }[];
  color: string;
}) {
  if (!points.length)
    return (
      <p className={styles.help}>
        아직 기록이 없습니다. 포트폴리오를 저장하거나 오늘 기록을 눌러
        시작하세요.
      </p>
    );
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = points.map((point, index) => ({
    x: points.length === 1 ? 300 : 22 + (index / (points.length - 1)) * 556,
    y: points.length === 1 ? 82 : 138 - ((point.value - min) / range) * 112,
  }));
  return (
    <div className={styles.trend}>
      <svg viewBox="0 0 600 160" role="img" aria-label="날짜별 평가금액 추이">
        <path d="M22 138 H578" stroke="#E5EAF2" strokeWidth="1" />
        {points.length > 1 && (
          <polyline
            points={coords.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        )}
        {coords.map((point, index) => (
          <circle
            key={points[index].date}
            cx={point.x}
            cy={point.y}
            r="4"
            fill={color}
          />
        ))}
      </svg>
      <div>
        <span>{points[0].date}</span>
        <strong>{fmt(points.at(-1)?.value ?? 0)}</strong>
        <span>{points.at(-1)?.date}</span>
      </div>
      {points.length === 1 && (
        <p className={styles.trendHint}>
          기록이 하루치입니다. 다음 기록부터 추이가 선으로 표시됩니다.
        </p>
      )}
    </div>
  );
}

type AssetSummaryRow = {
  id: string;
  kind: "stock" | "crypto";
  symbol: string;
  market?: Market;
  exchange?: string | null;
  name: string;
  detail: string;
  value: number | null;
  gain: number | null;
  gainPercent: number | null;
  dailyGain: number | null;
  dailyGainPercent: number | null;
};

function AssetList({
  investments,
  manualAssets,
  usdKrw,
  gainView,
  dailyLoading,
  onSelectAsset,
}: {
  investments: AssetSummaryRow[];
  manualAssets: Portfolio["manualAssets"];
  usdKrw: number;
  gainView: "total" | "daily";
  dailyLoading: boolean;
  onSelectAsset: (asset: AssetSelection) => void;
}) {
  return (
    <>
      <div className={styles.mobileAssetGroup}>
        <h2>
          투자 <span>{investments.length}</span>
        </h2>
        {investments.length ? (
          <div className={styles.mobileAssetList}>
            {investments.map((asset) => {
              const gain = gainView === "total" ? asset.gain : asset.dailyGain;
              const gainPercent =
                gainView === "total"
                  ? asset.gainPercent
                  : asset.dailyGainPercent;
              return (
                <button
                  type="button"
                  className={styles.mobileAssetRow}
                  key={asset.id}
                  onClick={() => onSelectAsset({ kind: asset.kind, id: asset.id })}
                  aria-label={`${asset.name} 상세 보기`}
                >
                  <div className={styles.mobileAssetIdentity}>
                    <AssetIcon
                      kind={asset.kind}
                      symbol={asset.symbol}
                      name={asset.name}
                      market={asset.market}
                      exchange={asset.exchange}
                    />
                    <div className={styles.mobileAssetName}>
                      <strong>{asset.name}</strong>
                      <small>{asset.detail}</small>
                    </div>
                  </div>
                  <div className={styles.mobileAssetValue}>
                    <strong>
                      {asset.value === null ? "—" : fmt(asset.value)}
                    </strong>
                    <small
                      className={
                        gain === null
                          ? ""
                          : gain >= 0
                            ? styles.mobileUp
                            : styles.mobileDown
                      }
                    >
                      {gain === null
                        ? gainView === "daily"
                          ? dailyLoading
                            ? "일간 시세 조회 중"
                            : "일간 시세 정보 없음"
                          : "매입가 정보 없음"
                        : `${gain > 0 ? "+" : ""}${fmt(gain)} (${gainPercent === null ? "—" : `${gainPercent > 0 ? "+" : ""}${pct(gainPercent)}`})`}
                    </small>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className={styles.mobileAssetEmpty}>
            등록된 투자 종목이 없습니다.
          </p>
        )}
      </div>
      {manualAssets.length > 0 && (
        <div className={styles.mobileAssetGroup}>
          <h2>
            현금·기타 <span>{manualAssets.length}</span>
          </h2>
          <div className={styles.mobileAssetList}>
            {manualAssets.map((asset) => (
              <button
                type="button"
                className={styles.mobileAssetRow}
                key={asset.id}
                onClick={() => onSelectAsset({ kind: "manual", id: asset.id })}
                aria-label={`${asset.name} 상세 보기`}
              >
                <div className={styles.mobileAssetIdentity}>
                  <AssetIcon
                    kind="cash"
                    symbol={asset.valueUsd === null ? "KRW" : "USD"}
                    name={asset.name}
                  />
                  <div className={styles.mobileAssetName}>
                    <strong>{asset.name}</strong>
                    <small>
                      {asset.valueUsd === null ? "원화" : "미국 달러"}
                    </small>
                  </div>
                </div>
                <div className={styles.mobileAssetValue}>
                  <strong>{fmt(manualAssetValueKrw(asset, usdKrw))}</strong>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AssetDetail({
  selection,
  portfolio,
  holdings,
  summary,
  onBack,
  onEdit,
}: {
  selection: AssetSelection;
  portfolio: Portfolio;
  holdings: Holding[];
  summary?: AssetSummaryRow;
  onBack: () => void;
  onEdit: (asset: AssetSelection) => void;
}) {
  const stockRows = selection.kind === "stock"
    ? holdings.filter((row) => stockAssetId(row) === selection.id || `holding:${row.id}` === selection.id)
    : [];
  const crypto = selection.kind === "crypto"
    ? portfolio.cryptoAssets.find((asset) => `crypto:${asset.id}` === selection.id)
    : null;
  const manual = selection.kind === "manual"
    ? portfolio.manualAssets.find((asset) => asset.id === selection.id)
    : null;
  const first = stockRows[0];
  const quantity = first
    ? stockRows.reduce((sum, row) => sum + row.quantity, 0)
    : crypto?.quantity ?? null;
  const costKnown = first && stockRows.every((row) => row.averageCost !== null);
  const averageCost = first && costKnown && quantity
    ? stockRows.reduce((sum, row) => sum + row.quantity * row.averageCost!, 0) / quantity
    : crypto?.averageCostKrw ?? null;
  const price = first
    ? first.currentPrice ?? first.capturedPrice
    : crypto?.quotedPriceKrw ?? null;
  const name = first?.name ?? crypto?.name ?? manual?.name;
  const stockValueKnown = stockRows.every((row) => (row.currentPrice ?? row.capturedPrice) !== null);
  const stockValue = stockRows.reduce((sum, row) => sum + holdingValueKrw(row, portfolio.usdKrw), 0);
  const stockCost = stockRows.reduce((sum, row) => sum + row.quantity * (row.averageCost ?? 0) * (row.market === "US" ? portfolio.usdKrw : 1), 0);
  const value = summary?.value ?? (first && stockValueKnown ? stockValue : null);
  const gain = summary?.gain ?? (first && costKnown && stockValueKnown ? stockValue - stockCost : null);
  const gainPercent = summary?.gainPercent ?? (gain !== null && stockCost > 0 ? gain / stockCost * 100 : null);
  if (!name) return <p className={styles.help}>자산을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.</p>;
  const unit = first?.market === "US" ? "USD" : "KRW";
  const unitPrice = (value: number | null) => value === null
    ? "—"
    : unit === "USD" ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}` : fmt(value);
  const bucketId = manual?.bucketId ?? crypto?.bucketId ??
    (first ? portfolio.assignments.find((item) => item.holdingId === first.id)?.bucketId : null);
  const bucketName = portfolio.buckets.find((bucket) => bucket.id === bucketId)?.name ?? "미분류";
  return (
    <section className={styles.assetDetail} aria-label={`${name} 상세 정보`}>
      <button type="button" className={styles.detailBack} onClick={onBack}>← 이전 화면</button>
      <div className={styles.detailHead}>
        <AssetIcon kind={selection.kind === "manual" ? "cash" : selection.kind} symbol={first?.symbol ?? crypto?.marketCode ?? (manual?.valueUsd === null ? "KRW" : "USD")} name={name} market={first?.market} exchange={first?.exchange} />
        <div><h2>{name}</h2><p>{first?.symbol ?? crypto?.marketCode ?? (manual?.valueUsd === null ? "원화 직접 입력" : "달러 직접 입력")} · {bucketName}</p></div>
      </div>
      <div className={styles.detailTotal}>
        <span>평가 금액</span>
        <strong>{manual ? fmt(manualAssetValueKrw(manual, portfolio.usdKrw)) : value === null ? "—" : fmt(value)}</strong>
        {!manual && <small className={gain === null ? "" : gain >= 0 ? styles.mobileUp : styles.mobileDown}>
          {gain === null ? "매입단가 정보 없음" : `${gain > 0 ? "+" : ""}${fmt(gain)} (${gainPercent === null ? "—" : `${gainPercent > 0 ? "+" : ""}${pct(gainPercent)}`})`}
        </small>}
      </div>
      <div className={styles.detailFacts}>
        {manual ? <>
          <div><span>입력 금액</span><strong>{manual.valueUsd === null ? fmt(manual.valueKrw) : `$${manual.valueUsd.toLocaleString("en-US")}`}</strong></div>
          <div><span>평가 기준</span><strong>{manual.valueUsd === null ? "원화 직접 입력" : `적용 환율 ${won.format(portfolio.usdKrw)}원`}</strong></div>
        </> : <>
          <div><span>보유 수량</span><strong>{quantityFormat.format(quantity ?? 0)}{first ? "주" : "개"}</strong></div>
          <div><span>현재가</span><strong>{unitPrice(price)}</strong></div>
          <div><span>평균 매입단가</span><strong>{unitPrice(averageCost)}</strong></div>
          <div><span>평가손익</span><strong className={gain === null ? "" : gain >= 0 ? styles.mobileUp : styles.mobileDown}>{gain === null ? "—" : `${gain > 0 ? "+" : ""}${fmt(gain)}`}</strong></div>
        </>}
      </div>
      {stockRows.length > 0 && <div className={styles.detailAccounts}>
        <h3>계좌별 보유</h3>
        {stockRows.map((row) => <div key={row.id}><span>{row.broker} · {row.account}<small>{quantityFormat.format(row.quantity)}주 · 매입단가 {row.averageCost === null ? "—" : unitPrice(row.averageCost)}</small></span><button type="button" onClick={() => onEdit({ kind: "stock", id: `holding:${row.id}` })}>수정</button></div>)}
      </div>}
      {manual && <p className={styles.detailHint}>직접 입력 자산은 평가 금액만 관리하며 매입단가와 손익은 계산하지 않습니다.</p>}
      <button type="button" className={styles.detailEdit} onClick={() => onEdit(selection)}>이 자산 수정 <Pencil size={16} /></button>
    </section>
  );
}

export default function PortfolioBuilder({
  userId,
  screen,
  holdings,
  dailyStockQuotes,
  dailyCryptoQuotes,
  onDailyCryptoQuotes,
  quoteVersion,
  onHoldings,
  onNotice,
  onRefreshQuotes,
  quotesRefreshing,
  quoteError,
  onImport,
  onEditHoldings,
  selectedAsset,
  focusAsset,
  onSelectAsset = () => {},
  onEditAsset = () => {},
  onBack = () => {},
  onNavigate,
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<Portfolio | null>(
    () => portfolioCache.get(userId) ?? null,
  );
  const [loading, setLoading] = useState(() => !portfolioCache.has(userId));
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [ruleMarket, setRuleMarket] = useState<Market>("KR");
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleBucketId, setRuleBucketId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualCurrency, setManualCurrency] = useState<"KRW" | "USD">("KRW");
  const [manualBucketId, setManualBucketId] = useState("");
  const [cryptoQuery, setCryptoQuery] = useState("");
  const [cryptoCandidates, setCryptoCandidates] = useState<CryptoMarket[]>([]);
  const [cryptoSelected, setCryptoSelected] = useState<CryptoMarket | null>(
    null,
  );
  const [cryptoQuantity, setCryptoQuantity] = useState("");
  const [cryptoCost, setCryptoCost] = useState("");
  const [cryptoBucketId, setCryptoBucketId] = useState("");
  const [lookingUpCrypto, setLookingUpCrypto] = useState(false);
  const [cryptoRefreshError, setCryptoRefreshError] = useState("");
  const [cryptoRefreshing, setCryptoRefreshing] = useState(false);
  const [fxRefreshError, setFxRefreshError] = useState("");
  const cryptoRefreshInFlight = useRef(false);
  const lastCryptoFetchAt = useRef(0);
  useEffect(() => {
    if (quotesRefreshing) lastCryptoFetchAt.current = Date.now();
  }, [quotesRefreshing]);
  const [trendKey, setTrendKey] = useState("__TOTAL__");
  const [show3d, setShow3d] = useState(false);
  const [rebalanceMode, setRebalanceMode] = useState<"trade" | "add-only">(
    "trade",
  );
  const [gainView, setGainView] = useState<"total" | "daily">("total");
  const [cashInput, setCashInput] = useState("");
  const [excludedHoldingIds, setExcludedHoldingIds] = useState<string[]>([]);
  const [flowDate, setFlowDate] = useState(kstDate);
  const [flowAmount, setFlowAmount] = useState("");
  const [flowKind, setFlowKind] = useState<"deposit" | "withdrawal">("deposit");
  const [flowNote, setFlowNote] = useState("");
  const [flowSaving, setFlowSaving] = useState(false);

  useEffect(() => {
    if (screen !== "edit" || !focusAsset || loading) return;
    if (focusAsset.kind === "stock") return;
    const id = focusAsset.kind === "crypto"
      ? `edit-crypto-${focusAsset.id.replace(/^crypto:/, "")}`
      : `edit-manual-${focusAsset.id}`;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [screen, focusAsset, loading]);

  useEffect(() => {
    let active = true;
    fetch("/api/portfolio", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          portfolio?: Portfolio;
          message?: string;
          fxWarning?: string | null;
        };
        if (!response.ok)
          throw new Error(
            payload.message || "포트폴리오를 불러오지 못했습니다.",
          );
        if (payload.fxWarning) onNotice(payload.fxWarning);
        return payload.portfolio ?? null;
      })
      .then((portfolio) => {
        if (active && !dirtyRef.current) {
          portfolioCache.set(userId, portfolio);
          setDraft(portfolio);
        }
        if (active && portfolio?.usdKrwMode === "auto") {
          const lastCheck = Number(
            sessionStorage.getItem("pf-fx-check-at") ?? 0,
          );
          if (Date.now() - lastCheck >= 60 * 60 * 1000) {
            sessionStorage.setItem("pf-fx-check-at", String(Date.now()));
            void fetch("/api/portfolio/fx", { method: "POST" })
              .then(async (response) => {
                if (!response.ok) throw new Error("환율 자동 갱신 실패");
                return (await response.json()) as {
                  fx?: {
                    rate: number;
                    rateDate: string | null;
                    updatedAt: string | null;
                  } | null;
                };
              })
              .then((result) => {
                if (!active || dirtyRef.current || !result?.fx) return;
                const fx = result.fx;
                setFxRefreshError("");
                const cached = portfolioCache.get(userId);
                if (cached?.usdKrwMode === "auto")
                  portfolioCache.set(userId, {
                    ...cached,
                    usdKrw: fx.rate,
                    usdKrwUpdatedAt: fx.updatedAt,
                    usdKrwRateDate: fx.rateDate,
                  });
                setDraft((current) =>
                  current?.usdKrwMode === "auto"
                    ? {
                        ...current,
                        usdKrw: fx.rate,
                        usdKrwUpdatedAt: fx.updatedAt,
                        usdKrwRateDate: fx.rateDate,
                      }
                    : current,
                );
              })
              .catch(() => {
                if (active)
                  setFxRefreshError("환율 갱신 실패 · 마지막 저장 환율 적용");
              });
          }
        }
      })
      .catch((error) => {
        if (active)
          onNotice(
            error instanceof Error
              ? error.message
              : "포트폴리오를 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [quoteVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasCryptoAssets = Boolean(draft?.cryptoAssets.length);
  useEffect(() => {
    if (!hasCryptoAssets || dirty) return;
    let active = true;
    async function refreshCrypto() {
      if (
        document.visibilityState !== "visible" ||
        quotesRefreshing ||
        cryptoRefreshInFlight.current ||
        Date.now() - lastCryptoFetchAt.current < 55_000
      )
        return;
      cryptoRefreshInFlight.current = true;
      setCryptoRefreshing(true);
      lastCryptoFetchAt.current = Date.now();
      try {
        const response = await fetch("/api/crypto/quotes", { method: "POST" });
        const payload = (await response.json()) as {
          quotes?: {
            marketCode: string;
            price: number | null;
            previousClose: number | null;
            checkedAt: string | null;
            lastTradeAt: string | null;
          }[];
          message?: string;
        };
        if (!response.ok || !payload.quotes)
          throw new Error(payload.message || "빗썸 시세 조회 실패");
        if (active) {
          onDailyCryptoQuotes(
            Object.fromEntries(
              payload.quotes.map((quote) => [
                quote.marketCode,
                {
                  previousClose: quote.previousClose,
                  checkedAt: quote.checkedAt,
                },
              ]),
            ),
          );
          const byCode = new Map(
            payload.quotes.map((quote) => [quote.marketCode, quote]),
          );
          setDraft((current) =>
            current
              ? {
                  ...current,
                  cryptoAssets: current.cryptoAssets.map((asset) => {
                    const quote = byCode.get(asset.marketCode);
                    return quote?.price === null || !quote
                      ? asset
                      : {
                          ...asset,
                          quotedPriceKrw: quote.price,
                          quoteCheckedAt: quote.checkedAt,
                          lastTradeAt: quote.lastTradeAt,
                        };
                  }),
                }
              : current,
          );
          setCryptoRefreshError(
            payload.quotes?.some((quote) => quote.price === null)
              ? "일부 빗썸 시세를 확인하지 못했습니다"
              : "",
          );
        }
      } catch (error) {
        if (active)
          setCryptoRefreshError(
            error instanceof Error ? error.message : "빗썸 시세 조회 실패",
          );
      } finally {
        cryptoRefreshInFlight.current = false;
        setCryptoRefreshing(false);
      }
    }
    void refreshCrypto();
    const timer = window.setInterval(() => {
      void refreshCrypto();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasCryptoAssets, dirty, quotesRefreshing]); // eslint-disable-line react-hooks/exhaustive-deps

  function change(next: Portfolio) {
    setDraft(next);
    setDirty(true);
  }
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefreshQuotes();
    } finally {
      setRefreshing(false);
    }
  }
  function begin(example: boolean) {
    const plan = emptyPortfolio();
    plan.buckets = example
      ? EXAMPLE_BUCKETS.map((bucket) => ({
          ...bucket,
          id: crypto.randomUUID(),
        }))
      : [
          {
            id: crypto.randomUUID(),
            name: "새 포트",
            targetPercent: 100,
            color: colors[0],
          },
        ];
    if (example) {
      plan.rules = EXAMPLE_RULES.map((item) => ({
        id: crypto.randomUUID(),
        bucketId: plan.buckets[item.bucketIndex].id,
        market: item.market,
        symbol: item.symbol,
        exchange: item.exchange,
        name: item.name,
        manualPrice: null,
        quotedPrice: null,
        quoteCheckedAt: null,
      }));
    }
    change(plan);
    setRuleBucketId(plan.buckets[0].id);
    setManualBucketId(plan.buckets[0].id);
  }
  function editBucket(id: string, key: keyof Bucket, value: string) {
    if (!draft) return;
    change({
      ...draft,
      buckets: draft.buckets.map((bucket) =>
        bucket.id === id
          ? {
              ...bucket,
              [key]: key === "targetPercent" ? Number(value) : value,
            }
          : bucket,
      ),
    });
  }
  function removeBucket(id: string) {
    if (!draft || draft.buckets.length <= 1) return;
    change({
      ...draft,
      buckets: draft.buckets.filter((bucket) => bucket.id !== id),
      rules: draft.rules.filter((rule) => rule.bucketId !== id),
      manualAssets: draft.manualAssets.map((asset) =>
        asset.bucketId === id ? { ...asset, bucketId: null } : asset,
      ),
      cryptoAssets: draft.cryptoAssets.map((asset) =>
        asset.bucketId === id ? { ...asset, bucketId: null } : asset,
      ),
      assignments: draft.assignments.map((assignment) =>
        assignment.bucketId === id
          ? { ...assignment, bucketId: null }
          : assignment,
      ),
    });
  }
  function addBucket() {
    if (!draft || draft.buckets.length >= 20) return;
    change({
      ...draft,
      buckets: [
        ...draft.buckets,
        {
          id: crypto.randomUUID(),
          name: "새 포트",
          targetPercent: 0,
          color: colors[draft.buckets.length % colors.length],
        },
      ],
    });
  }
  async function lookup() {
    if (!ruleQuery.trim())
      return onNotice("종목명 또는 종목코드를 입력해 주세요.");
    setLookingUp(true);
    try {
      const response = await fetch(
        `/api/instruments?market=${ruleMarket}&query=${encodeURIComponent(ruleQuery.trim())}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        instruments?: Candidate[];
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message || "종목을 찾지 못했습니다.");
      setCandidates(payload.instruments ?? []);
      if (!payload.instruments?.length)
        onNotice("KIS 종목 마스터에서 일치하는 종목을 찾지 못했습니다.");
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "종목을 찾지 못했습니다.",
      );
    } finally {
      setLookingUp(false);
    }
  }
  function addRule(candidate: Candidate) {
    if (!draft) return;
    const bucketId = ruleBucketId || draft.buckets[0]?.id;
    if (!bucketId) return;
    if (
      draft.rules.some(
        (rule) =>
          rule.market === candidate.market && rule.symbol === candidate.symbol,
      )
    )
      return onNotice(
        "이 종목코드는 이미 다른 포트의 자동 배정 규칙에 있습니다.",
      );
    change({
      ...draft,
      rules: [
        ...draft.rules,
        {
          id: crypto.randomUUID(),
          bucketId,
          market: candidate.market,
          symbol: candidate.symbol,
          exchange: candidate.exchange,
          name: candidate.name,
          manualPrice: null,
          quotedPrice: null,
          quoteCheckedAt: null,
        },
      ],
    });
    setCandidates([]);
    setRuleQuery("");
    onNotice(
      `${candidate.name} 종목을 자동 배정 규칙에 추가했습니다. 저장하면 같은 코드의 보유 종목이 배정됩니다.`,
    );
  }
  function addManualAsset() {
    if (!draft || !manualName.trim())
      return onNotice("수동 자산 이름을 입력해 주세요.");
    const value = Number(manualValue);
    if (!Number.isFinite(value) || value < 0)
      return onNotice("자산 금액을 확인해 주세요.");
    change({
      ...draft,
      manualAssets: [
        ...draft.manualAssets,
        {
          id: crypto.randomUUID(),
          bucketId: manualBucketId || null,
          name: manualName.trim(),
          valueKrw: manualCurrency === "USD" ? value * draft.usdKrw : value,
          valueUsd: manualCurrency === "USD" ? value : null,
        },
      ],
    });
    setManualName("");
    setManualValue("");
  }
  async function lookupCrypto() {
    if (!cryptoQuery.trim())
      return onNotice("가상자산명이나 코드를 입력해 주세요.");
    setLookingUpCrypto(true);
    try {
      const response = await fetch(
        `/api/crypto/markets?query=${encodeURIComponent(cryptoQuery.trim())}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        markets?: CryptoMarket[];
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message || "원화마켓을 찾지 못했습니다.");
      setCryptoCandidates(payload.markets ?? []);
      if (!payload.markets?.length)
        onNotice("일치하는 빗썸 원화마켓이 없습니다.");
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : "원화마켓을 찾지 못했습니다.",
      );
    } finally {
      setLookingUpCrypto(false);
    }
  }
  function addCryptoAsset() {
    if (!draft || !cryptoSelected)
      return onNotice("빗썸 원화마켓을 먼저 선택해 주세요.");
    const quantity = Number(cryptoQuantity);
    const averageCostKrw = cryptoCost.trim() === "" ? null : Number(cryptoCost);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity >= 1e12 ||
      Math.round(quantity * 1e12) !== quantity * 1e12
    )
      return onNotice("보유 수량을 소수점 12자리 이내로 입력해 주세요.");
    if (
      averageCostKrw !== null &&
      (!Number.isFinite(averageCostKrw) ||
        averageCostKrw <= 0 ||
        averageCostKrw >= 1e12)
    )
      return onNotice("코인당 매입단가는 양수로 입력해 주세요.");
    if (
      draft.cryptoAssets.some(
        (asset) => asset.marketCode === cryptoSelected.marketCode,
      )
    )
      return onNotice(
        "같은 가상자산은 한 번만 등록할 수 있습니다. 기존 수량을 수정해 주세요.",
      );
    const bucketId =
      cryptoBucketId ||
      draft.buckets.find((bucket) =>
        /비트코인|가상자산|코인/i.test(bucket.name),
      )?.id ||
      draft.buckets[0]?.id ||
      null;
    change({
      ...draft,
      cryptoAssets: [
        ...draft.cryptoAssets,
        {
          id: crypto.randomUUID(),
          bucketId,
          marketCode: cryptoSelected.marketCode,
          name: cryptoSelected.name,
          quantity,
          averageCostKrw,
          quotedPriceKrw: null,
          quoteCheckedAt: null,
          lastTradeAt: null,
        },
      ],
    });
    setCryptoSelected(null);
    setCryptoQuery("");
    setCryptoQuantity("");
    setCryptoCost("");
    setCryptoCandidates([]);
    onNotice("가상자산을 추가했습니다. 저장하면 빗썸 원화 시세를 조회합니다.");
  }
  function assign(holdingId: string, value: string) {
    if (!draft) return;
    const next = draft.assignments.filter(
      (item) => item.holdingId !== holdingId,
    );
    next.push({
      holdingId,
      bucketId: value === "auto" || value === "unassigned" ? null : value,
      source: value === "auto" ? "auto" : "manual",
    });
    change({ ...draft, assignments: next });
  }
  async function save() {
    if (!draft) return;
    if (draft.manualAssets.some((asset) => !asset.name.trim()))
      return onNotice("직접 입력 자산 이름을 입력해 주세요.");
    const total = draft.buckets.reduce(
      (sum, bucket) => sum + bucket.targetPercent,
      0,
    );
    if (Math.abs(total - 100) > 0.01)
      return onNotice(
        `목표 비중 합계가 ${pct(total)}입니다. 100%로 맞춰 주세요.`,
      );
    const saved = portfolioCache.get(userId);
    const assetsOnly =
      screen === "edit" &&
      Boolean(saved) &&
      JSON.stringify({
        title: draft.title,
        usdKrw: draft.usdKrw,
        usdKrwMode: draft.usdKrwMode,
        usdKrwRateDate: draft.usdKrwRateDate,
        tolerancePercent: draft.tolerancePercent,
        buckets: draft.buckets,
        rules: draft.rules,
        assignments: draft.assignments,
      }) ===
        JSON.stringify({
          title: saved?.title,
          usdKrw: saved?.usdKrw,
          usdKrwMode: saved?.usdKrwMode,
          usdKrwRateDate: saved?.usdKrwRateDate,
          tolerancePercent: saved?.tolerancePercent,
          buckets: saved?.buckets,
          rules: saved?.rules,
          assignments: saved?.assignments,
        });
    setSaving(true);
    try {
      const response = await fetch("/api/portfolio", {
        method: assetsOnly ? "PATCH" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as {
        portfolio?: Portfolio;
        message?: string;
      };
      if (!response.ok || !payload.portfolio)
        throw new Error(payload.message || "저장하지 못했습니다.");
      if (
        draft.cryptoAssets.some(
          (asset) =>
            !saved?.cryptoAssets.some(
              (previous) => previous.marketCode === asset.marketCode,
            ),
        )
      )
        lastCryptoFetchAt.current = 0;
      setDraft(payload.portfolio);
      portfolioCache.set(userId, payload.portfolio);
      setDirty(false);
      onNotice("포트폴리오와 오늘의 평가액을 저장했습니다.");
      if (!assetsOnly)
        void fetch("/api/holdings", { cache: "no-store" })
          .then(async (response) => {
            if (response.ok)
              onHoldings(
                ((await response.json()) as { holdings: Holding[] }).holdings,
              );
          })
          .catch(() => {});
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "포트폴리오를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function record() {
    if (dirty) return onNotice("변경 내용을 먼저 저장해 주세요.");
    try {
      const response = await fetch("/api/portfolio", { method: "POST" });
      const payload = (await response.json()) as {
        portfolio?: Portfolio;
        message?: string;
      };
      if (!response.ok || !payload.portfolio)
        throw new Error(payload.message || "기록하지 못했습니다.");
      setDraft(payload.portfolio);
      portfolioCache.set(userId, payload.portfolio);
      onNotice("오늘의 자산 평가액을 기록했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "기록하지 못했습니다.");
    }
  }
  async function saveFlow() {
    if (dirty) return onNotice("포트폴리오를 먼저 저장해 주세요.");
    const amount = Number(flowAmount);
    if (
      !flowDate ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isInteger(amount)
    )
      return onNotice("입출금 날짜와 원화 금액을 확인해 주세요.");
    setFlowSaving(true);
    try {
      const response = await fetch("/api/portfolio/cash-flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: flowDate,
          amountKrw: flowKind === "deposit" ? amount : -amount,
          note: flowNote,
        }),
      });
      const payload = (await response.json()) as {
        portfolio?: Portfolio;
        message?: string;
      };
      if (!response.ok || !payload.portfolio)
        throw new Error(payload.message || "저장하지 못했습니다.");
      setDraft(payload.portfolio);
      setFlowAmount("");
      setFlowNote("");
      onNotice("입출금 내역을 저장했습니다.");
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "입출금 내역을 저장하지 못했습니다.",
      );
    } finally {
      setFlowSaving(false);
    }
  }
  async function removeFlow(id: string) {
    if (dirty) return onNotice("변경 내용을 먼저 저장해 주세요.");
    try {
      const response = await fetch(
        `/api/portfolio/cash-flows?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        portfolio?: Portfolio;
        message?: string;
      };
      if (!response.ok || !payload.portfolio)
        throw new Error(payload.message || "삭제하지 못했습니다.");
      setDraft(payload.portfolio);
      onNotice("입출금 내역을 삭제했습니다.");
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : "입출금 내역을 삭제하지 못했습니다.",
      );
    }
  }

  const values = useMemo(
    () => (draft ? portfolioValues(draft, holdings) : null),
    [draft, holdings],
  );
  const advice = useMemo(
    () =>
      draft
        ? rebalance(
            draft,
            holdings,
            rebalanceMode,
            cashInput.trim() && Number.isFinite(Number(cashInput))
              ? Math.min(1e15, Math.max(0, Number(cashInput)))
              : null,
            new Set(excludedHoldingIds),
          )
        : {
            items: [],
            trades: [],
            requiredCash: 0,
            residualCash: 0,
            newCash: 0,
            projectedUnassignedPercent: 0,
            ready: false,
          },
    [draft, holdings, rebalanceMode, cashInput, excludedHoldingIds],
  );
  const rebalanceReady = Boolean(
    values &&
      values.total > 0 &&
      values.unassigned === 0 &&
      values.missingPrices === 0,
  );
  const actionItems = rebalanceReady
    ? advice.items.filter(
        (item) =>
          advice.trades.some((trade) => trade.bucketId === item.bucket.id) ||
          needsAdjustment(
            item.bucket.targetPercent,
            item.current,
            item.currentPercent,
            draft?.tolerancePercent ?? 0,
          ),
      )
    : [];
  const inRangeCount = rebalanceReady
    ? advice.items.length - actionItems.length
    : 0;
  const targetTotal =
    draft?.buckets.reduce((sum, bucket) => sum + bucket.targetPercent, 0) ?? 0;
  const history =
    draft?.snapshots
      .filter((point) => point.bucketKey === trendKey)
      .map((point) => ({ date: point.date, value: point.valueKrw })) ?? [];
  const trendColor =
    draft?.buckets.find((bucket) => bucket.id === trendKey)?.color ?? "#4B72E8";
  const driftItems = advice.items
    .filter((item) =>
      needsAdjustment(
        item.bucket.targetPercent,
        item.current,
        item.currentPercent,
        draft?.tolerancePercent ?? 0,
      ),
    )
    .sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));
  const priceFromQuote = holdings.filter(
    (holding) =>
      holding.currentPrice !== null && holding.quoteCheckedAt !== null,
  ).length;
  const priceFromCapture = holdings.filter(
    (holding) =>
      holding.currentPrice === null && holding.capturedPrice !== null,
  ).length;
  const latestQuote =
    holdings
      .map((holding) => holding.quoteCheckedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const oldestCapture =
    holdings
      .filter(
        (holding) =>
          holding.currentPrice === null && holding.capturedPrice !== null,
      )
      .map((holding) => holding.capturedAt)
      .sort()[0] ?? null;
  const totalHistory =
    draft?.snapshots.filter((point) => point.bucketKey === "__TOTAL__") ?? [];
  const firstPoint = totalHistory[0];
  const lastPoint = totalHistory.at(-1);
  const periodFlow =
    draft?.cashFlows
      .filter(
        (flow) =>
          firstPoint &&
          lastPoint &&
          flow.date > firstPoint.date &&
          flow.date <= lastPoint.date,
      )
      .reduce((sum, flow) => sum + flow.amountKrw, 0) ?? 0;
  const adjustedChange =
    firstPoint && lastPoint && firstPoint.date !== lastPoint.date
      ? lastPoint.valueKrw - firstPoint.valueKrw - periodFlow
      : null;

  const knownGains = holdings.reduce(
    (summary, holding) => {
      const price = holding.currentPrice ?? holding.capturedPrice;
      if (price !== null && holding.averageCost !== null) {
        const rate = holding.market === "US" ? (draft?.usdKrw ?? 0) : 1;
        summary.value +=
          (price - holding.averageCost) * holding.quantity * rate;
        summary.cost += holding.averageCost * holding.quantity * rate;
        summary.count++;
      }
      return summary;
    },
    { value: 0, cost: 0, count: 0 },
  );
  for (const asset of draft?.cryptoAssets ?? []) {
    if (asset.quotedPriceKrw !== null && asset.averageCostKrw !== null) {
      knownGains.value +=
        (asset.quotedPriceKrw - asset.averageCostKrw) * asset.quantity;
      knownGains.cost += asset.averageCostKrw * asset.quantity;
      knownGains.count++;
    }
  }
  const gainEligibleCount = holdings.length + (draft?.cryptoAssets.length ?? 0);
  const mobileStockGroups = new Map<
    string,
    {
      id: string;
      name: string;
      market: Market;
      symbol: string;
      exchange: string | null;
      quantity: number;
      value: number;
      gain: number;
      cost: number;
      missingPrice: boolean;
      missingCost: boolean;
      capturedOnly: boolean;
      dailyGain: number;
      dailyBase: number;
      missingDaily: boolean;
    }
  >();
  for (const holding of holdings) {
    const id = stockAssetId(holding);
    const group = mobileStockGroups.get(id) ?? {
      id,
      name: holding.name,
      market: holding.market,
      symbol: holding.symbol,
      exchange: holding.exchange ?? null,
      quantity: 0,
      value: 0,
      gain: 0,
      cost: 0,
      missingPrice: false,
      missingCost: false,
      capturedOnly: false,
      dailyGain: 0,
      dailyBase: 0,
      missingDaily: false,
    };
    const price = holding.currentPrice ?? holding.capturedPrice;
    const dailyQuote = dailyStockQuotes.find(
      (quote) =>
        quote.market === holding.market &&
        quote.symbol === holding.symbol &&
        (!holding.exchange || quote.exchange === holding.exchange),
    );
    const rate = holding.market === "US" ? (draft?.usdKrw ?? 0) : 1;
    group.quantity += holding.quantity;
    group.capturedOnly ||= holding.currentPrice === null;
    group.missingPrice ||= price === null;
    group.missingCost ||= holding.averageCost === null;
    group.missingDaily ||=
      holding.currentPrice === null || dailyQuote?.previousClose == null;
    if (holding.currentPrice !== null && dailyQuote?.previousClose != null) {
      group.dailyGain +=
        (holding.currentPrice - dailyQuote.previousClose) *
        holding.quantity *
        rate;
      group.dailyBase += dailyQuote.previousClose * holding.quantity * rate;
    }
    if (price !== null) group.value += holding.quantity * price * rate;
    if (holding.averageCost !== null) {
      group.cost += holding.averageCost * holding.quantity * rate;
      if (price !== null) {
        group.gain += (price - holding.averageCost) * holding.quantity * rate;
      }
    }
    mobileStockGroups.set(id, group);
  }
  const mobileInvestments = draft
    ? [
        ...[...mobileStockGroups.values()].map((group) => ({
          id: group.id,
          kind: "stock" as const,
          symbol: group.symbol,
          market: group.market,
          exchange: group.exchange,
          name: group.name,
          detail: `${group.symbol || group.market} · ${quantityFormat.format(group.quantity)}주${group.capturedOnly ? " · 캡처 기준" : ""}`,
          value: group.missingPrice ? null : group.value,
          gain: group.missingPrice || group.missingCost ? null : group.gain,
          gainPercent:
            group.missingPrice || group.missingCost || group.cost === 0
              ? null
              : (group.gain / group.cost) * 100,
          dailyGain: group.missingDaily ? null : group.dailyGain,
          dailyGainPercent:
            group.missingDaily || group.dailyBase === 0
              ? null
              : (group.dailyGain / group.dailyBase) * 100,
        })),
        ...draft.cryptoAssets.map((asset) => ({
          id: `crypto:${asset.id}`,
          kind: "crypto" as const,
          symbol: asset.marketCode,
          name: asset.name,
          detail: `${asset.marketCode} · ${quantityFormat.format(asset.quantity)}개`,
          value:
            asset.quotedPriceKrw === null ? null : cryptoAssetValueKrw(asset),
          gain:
            asset.quotedPriceKrw === null || asset.averageCostKrw === null
              ? null
              : (asset.quotedPriceKrw - asset.averageCostKrw) * asset.quantity,
          gainPercent:
            asset.quotedPriceKrw === null || asset.averageCostKrw === null
              ? null
              : ((asset.quotedPriceKrw - asset.averageCostKrw) /
                  asset.averageCostKrw) *
                100,
          dailyGain:
            asset.quotedPriceKrw === null ||
            dailyCryptoQuotes[asset.marketCode]?.previousClose == null
              ? null
              : (asset.quotedPriceKrw -
                  dailyCryptoQuotes[asset.marketCode].previousClose!) *
                asset.quantity,
          dailyGainPercent:
            asset.quotedPriceKrw === null ||
            dailyCryptoQuotes[asset.marketCode]?.previousClose == null
              ? null
              : ((asset.quotedPriceKrw -
                  dailyCryptoQuotes[asset.marketCode].previousClose!) /
                  dailyCryptoQuotes[asset.marketCode].previousClose!) *
                100,
        })),
      ].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    : [];
  const dailyKnown = mobileInvestments.reduce(
    (summary, asset) => {
      if (asset.dailyGain !== null && asset.value !== null) {
        summary.value += asset.dailyGain;
        summary.base += asset.value - asset.dailyGain;
        summary.count++;
      }
      return summary;
    },
    { value: 0, base: 0, count: 0 },
  );
  const displayedGain =
    gainView === "total"
      ? knownGains.count
        ? knownGains.value
        : null
      : dailyKnown.count
        ? dailyKnown.value
        : null;
  const displayedGainPercent =
    gainView === "total"
      ? knownGains.cost > 0
        ? (knownGains.value / knownGains.cost) * 100
        : null
      : dailyKnown.base > 0
        ? (dailyKnown.value / dailyKnown.base) * 100
        : null;
  const displayedGainNote =
    gainView === "total"
      ? `매입단가 확인 ${knownGains.count}/${gainEligibleCount}개`
      : `전일 종가 확인 ${dailyKnown.count}/${mobileInvestments.length}개 · 현재 보유 수량 기준`;
  const latestCryptoQuote = draft?.cryptoAssets
    .map((asset) => asset.quoteCheckedAt)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1);
  const latestPriceTime =
    [latestQuote, latestCryptoQuote]
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null;
  const titles = {
    dashboard: [
      "MY PORTFOLIO",
      "내 포트폴리오",
      "전체 비중과 핵심 지표를 확인하세요.",
    ],
    strategy: [
      "TARGET ALLOCATION",
      "목표 설계",
      "원하는 포트 비중과 리밸런싱 기준을 정하세요.",
    ],
    composition: [
      "PORTFOLIO MIX",
      "포트별 자산 비중",
      "현재 보유 비중과 목표의 차이를 살펴보세요.",
    ],
    allocation: [
      "ASSET ALLOCATION",
      "자산 배정",
      "보유 자산을 원하는 포트에 연결하세요.",
    ],
    edit: [
      "ASSET EDITOR",
      "자산 수정",
      "주식·가상자산·현금의 보유 정보를 수정하세요.",
    ],
    rebalance: [
      "REBALANCE",
      "리밸런싱",
      "목표 비중에 맞는 거래 수량을 확인하세요.",
    ],
    history: [
      "HISTORY",
      "자산 기록",
      "포트별 자산 추이와 입출금 기록을 확인하세요.",
    ],
    detail: ["ASSET DETAIL", "자산 상세", "보유 현황과 평가손익을 확인하세요."],
  }[screen];

  if (loading)
    return (
      <div className={styles.loading}>포트폴리오를 불러오는 중입니다…</div>
    );
  if (!draft)
    return (
      <div className={styles.start}>
        <span>PORTFOLIO DESIGNER</span>
        <h1>내 투자 원칙부터 정해보세요.</h1>
        <p>
          어떤 자산을 몇 퍼센트 보유할지 직접 정하고, 종목코드로 실제 자산을
          연결할 수 있습니다.
        </p>
        <div>
          <button onClick={() => begin(true)}>
            예시 구성으로 시작 <ArrowRight size={17} />
          </button>
          <button onClick={() => begin(false)}>빈 포트로 시작</button>
        </div>
        <small>
          예시 비중은 자유롭게 수정할 수 있습니다. 저장하기 전까지 계정에
          반영되지 않습니다.
        </small>
        <a
          className={styles.startQuote}
          href="https://www.berkshirehathaway.com/letters/2013ltr.pdf"
          target="_blank"
          rel="noreferrer"
        >
          “가격은 지불하는 것, 가치는 얻는 것.” <span>— 벤저민 그레이엄</span>
        </a>
      </div>
    );

  return (
    <div
      className={`${styles.builder} ${screen === "dashboard" ? styles.homeBuilder : ""}`}
    >
      {screen !== "edit" && (
        <div className={styles.heading}>
          <div>
            <h1>{titles[1]}</h1>
            <p>{titles[2]}</p>
          </div>
          <div>
            <button
              className={styles.ghost}
              onClick={refresh}
              disabled={refreshing || quotesRefreshing}
            >
              <RefreshCw size={16} />{" "}
              {refreshing || quotesRefreshing ? "갱신 중" : "가격 갱신"}
            </button>
            {dirty ? (
              <button className={styles.save} onClick={save} disabled={saving}>
                {saving ? "저장 중" : "변경 내용 저장"}
              </button>
            ) : screen !== "dashboard" && screen !== "detail" ? (
              <span className={styles.saved}>
                <Check size={15} /> 저장됨
              </span>
            ) : null}
          </div>
        </div>
      )}

      {screen === "detail" && selectedAsset && (
        <AssetDetail
          selection={selectedAsset}
          portfolio={draft}
          holdings={holdings}
          summary={mobileInvestments.find((asset) => asset.id === selectedAsset.id)}
          onBack={onBack}
          onEdit={onEditAsset}
        />
      )}

      {screen === "dashboard" && (
        <>
          <section className={styles.mobileDashboard} aria-label="내 자산 요약">
            <div className={styles.mobileDashboardTop}>
              <span>총 평가액</span>
              <button
                type="button"
                aria-label="가격 새로고침"
                onClick={refresh}
                disabled={refreshing || quotesRefreshing}
              >
                <RefreshCw
                  size={18}
                  className={
                    refreshing || quotesRefreshing ? styles.mobileSpinning : ""
                  }
                />
              </button>
            </div>
            <div className={styles.mobileTotal}>
              {won.format(values?.total ?? 0)}
              <span>원</span>
            </div>
            <div className={styles.mobileMetricList}>
              <div className={styles.gainMetric}>
                <div>
                  <div
                    className={styles.gainToggle}
                    role="group"
                    aria-label="수익 표시 기간"
                  >
                    <button
                      type="button"
                      aria-pressed={gainView === "total"}
                      onClick={() => setGainView("total")}
                    >
                      전체 수익
                    </button>
                    <button
                      type="button"
                      aria-pressed={gainView === "daily"}
                      onClick={() => setGainView("daily")}
                    >
                      일간 수익
                    </button>
                  </div>
                  <small>{displayedGainNote}</small>
                </div>
                <strong
                  className={
                    displayedGain === null
                      ? ""
                      : displayedGain >= 0
                        ? styles.mobileUp
                        : styles.mobileDown
                  }
                >
                  {displayedGain === null
                    ? "—"
                    : `${displayedGain > 0 ? "+" : ""}${fmt(displayedGain)}`}
                </strong>
              </div>
              <div>
                <span>
                  {gainView === "daily" ? "일간 수익률" : "전체 수익률"}{" "}
                  <small>확인분</small>
                </span>
                <strong
                  className={
                    displayedGainPercent === null
                      ? ""
                      : displayedGainPercent >= 0
                        ? styles.mobileUp
                        : styles.mobileDown
                  }
                >
                  {displayedGainPercent === null
                    ? "—"
                    : `${displayedGainPercent > 0 ? "+" : ""}${pct(displayedGainPercent)}`}
                </strong>
              </div>
            </div>
            <details className={styles.mobileMetricNote}>
              <summary>손익 집계 기준</summary>
              <p>
                전체 손익은 매입단가와 현재가가 확인된 주식·가상자산{" "}
                {knownGains.count}/{gainEligibleCount}개 기준입니다. 현금은 손익
                계산에 포함되지 않습니다. 일간 손익은 각 시장의 전일 종가와
                현재가 차이에 현재 보유 수량을 곱해 계산합니다. 환율 변동과
                현금은 제외합니다.
              </p>
            </details>
            <div className={styles.mobileQuoteTime}>
              <span
                className={quotesRefreshing ? styles.livePulse : styles.liveDot}
              />
              {quotesRefreshing
                ? "시세 갱신 중"
                : `최근 시세 ${timeLabel(latestPriceTime)}`}
            </div>
            {(quoteError || fxRefreshError) && (
              <div className={styles.mobileDataError}>
                {quoteError || fxRefreshError}
              </div>
            )}
            <AssetList
              investments={mobileInvestments}
              manualAssets={draft.manualAssets}
              usdKrw={draft.usdKrw}
              gainView={gainView}
              dailyLoading={quotesRefreshing || cryptoRefreshing}
              onSelectAsset={onSelectAsset}
            />
          </section>
          <div className={styles.desktopLiveStatus} role="status">
            <span
              className={quotesRefreshing ? styles.livePulse : styles.liveDot}
            />
            <span>
              {quotesRefreshing
                ? "시세 갱신 중"
                : `최근 시세 ${timeLabel(latestPriceTime)}`}
            </span>
            <span>주식 약 5분 · 빗썸 약 1분 간격</span>
            {(quoteError || fxRefreshError) && (
              <em>{quoteError || fxRefreshError}</em>
            )}
          </div>
          <div className={styles.desktopOverview}>
            <div className={styles.desktopPrimary}>
              <div className={styles.desktopMetricGrid}>
                <section className={styles.desktopTotal}>
                  <span>총 평가액</span>
                  <strong>{fmt(values?.total ?? 0)}</strong>
                  <small>{draft.title}</small>
                </section>
                <section className={styles.desktopGain}>
                  <div>
                    <div
                      className={styles.gainToggle}
                      role="group"
                      aria-label="수익 표시 기간"
                    >
                      <button
                        type="button"
                        aria-pressed={gainView === "total"}
                        onClick={() => setGainView("total")}
                      >
                        전체 수익
                      </button>
                      <button
                        type="button"
                        aria-pressed={gainView === "daily"}
                        onClick={() => setGainView("daily")}
                      >
                        일간 수익
                      </button>
                    </div>
                    <strong
                      className={
                        displayedGain === null
                          ? ""
                          : displayedGain >= 0
                            ? styles.profitUp
                            : styles.profitDown
                      }
                    >
                      {displayedGain === null
                        ? "—"
                        : `${displayedGain > 0 ? "+" : ""}${fmt(displayedGain)}`}
                    </strong>
                    <small>
                      {displayedGainPercent !== null
                        ? `${displayedGainPercent > 0 ? "+" : ""}${pct(displayedGainPercent)} · `
                        : ""}
                      {displayedGainNote}
                    </small>
                  </div>
                </section>
              </div>
              <section className={styles.desktopAssetPanel}>
                <div className={styles.desktopSectionHead}>
                  <div>
                    <h2>보유 자산</h2>
                  </div>
                  <button type="button" onClick={onEditHoldings}>
                    자산 수정 <ArrowRight size={14} />
                  </button>
                </div>
                <AssetList
                  investments={mobileInvestments}
                  manualAssets={draft.manualAssets}
                  usdKrw={draft.usdKrw}
                  gainView={gainView}
                  dailyLoading={quotesRefreshing || cryptoRefreshing}
                  onSelectAsset={onSelectAsset}
                />
              </section>
            </div>
            <aside className={styles.desktopSide} aria-label="포트폴리오 구성">
              <PortfolioVisuals portfolio={draft} holdings={holdings} />
              <section className={styles.desktopTarget}>
                <div>
                  <span>목표 비중 점검</span>
                  <strong>
                    {rebalanceReady
                      ? `${driftItems.length}개 조정 필요`
                      : "배정·가격 확인 필요"}
                  </strong>
                  <small>
                    {!rebalanceReady
                      ? "미분류 자산과 시세를 확인하세요"
                      : driftItems[0]
                        ? `${driftItems[0].bucket.name} ${driftItems[0].gapPercent > 0 ? "+" : ""}${driftItems[0].gapPercent.toFixed(1)}%p`
                        : "목표 비중 안에 있습니다"}
                  </small>
                </div>
                <button type="button" onClick={() => onNavigate("rebalance")}>
                  리밸런싱 보기 <ArrowRight size={15} />
                </button>
              </section>
              <details className={styles.dataDetails}>
                <summary>
                  가격·환율 기준 보기 <ChevronDown size={15} />
                </summary>
                <div
                  className={styles.dataStatus}
                  aria-label="평가 데이터 기준 시각"
                >
                  <strong>평가 기준</strong>
                  <span>
                    KIS 가격 {priceFromQuote}개 · 최근 확인{" "}
                    {timeLabel(latestQuote)}
                  </span>
                  <span>
                    캡처 가격 {priceFromCapture}개
                    {oldestCapture
                      ? ` · 가장 오래된 ${timeLabel(oldestCapture)}`
                      : ""}
                  </span>
                  <span>
                    {draft.usdKrwMode === "auto"
                      ? "자동 기준환율"
                      : "직접 입력 환율"}{" "}
                    USD {won.format(draft.usdKrw)}원
                  </span>
                  {draft.cryptoAssets.length > 0 && (
                    <span>
                      빗썸 원화 시세{" "}
                      {
                        draft.cryptoAssets.filter(
                          (asset) => asset.quotedPriceKrw !== null,
                        ).length
                      }
                      /{draft.cryptoAssets.length}개
                    </span>
                  )}
                  {cryptoRefreshError && <em>{cryptoRefreshError}</em>}
                  {(values?.missingPrices ?? 0) > 0 && (
                    <em>
                      가격 없는 자산 {values?.missingPrices}개는 평가액에서 제외
                    </em>
                  )}
                </div>
              </details>
              <p className={styles.desktopMetricNote}>
                평가손익은 매입단가가 확인된 주식·가상자산 기준이며 환차손익은
                포함하지 않습니다. 일간 손익은 각 시장 전일 종가와 현재가의
                차이를 현재 보유 수량에 적용하며 환율 변동과 현금은 제외합니다.
              </p>
            </aside>
          </div>
        </>
      )}

      {screen === "composition" && (
        <div className={styles.compositionView}>
          <PortfolioVisuals portfolio={draft} holdings={holdings} />
          <div className={styles.screenLinks}>
            <button type="button" onClick={() => onNavigate("rebalance")}>
              리밸런싱 보기 <ArrowRight size={16} />
            </button>
            <button type="button" onClick={() => onNavigate("allocation")}>
              자산 배정 수정 <ArrowRight size={16} />
            </button>
          </div>
        </div>
      )}

      {screen === "strategy" && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>목표 비중 편집</h2>
              </div>
              <button className={styles.ghost} onClick={addBucket}>
                <Plus size={16} /> 포트 추가
              </button>
            </div>
            <label className={styles.toleranceControl}>
              <span>
                <strong>리밸런싱 허용 오차</strong>
                <small>
                  목표 비중과 현재 비중의 차이가 이 값을 넘으면 조정을
                  추천합니다.
                </small>
              </span>
              <span className={styles.toleranceInput}>
                ±
                <input
                  type="number"
                  min="0"
                  max="30"
                  step="0.1"
                  value={draft.tolerancePercent}
                  aria-label="리밸런싱 허용 오차 퍼센트포인트"
                  onChange={(event) =>
                    change({
                      ...draft,
                      tolerancePercent: Number(event.target.value),
                    })
                  }
                />
                %p
              </span>
            </label>
            <details className={styles.advancedSettings}>
              <summary>
                환율·기타 설정 <span>USD {won.format(draft.usdKrw)}원</span>
                <ChevronDown size={15} />
              </summary>
              <div className={styles.settings}>
                <label>
                  포트폴리오 이름
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      change({ ...draft, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  환율 적용 방식
                  <select
                    value={draft.usdKrwMode}
                    onChange={(event) =>
                      change({
                        ...draft,
                        usdKrwMode: event.target.value as "auto" | "manual",
                        usdKrwRateDate: null,
                      })
                    }
                  >
                    <option value="auto">자동 · ECB 일일 기준환율</option>
                    <option value="manual">직접 입력</option>
                  </select>
                </label>
                <label>
                  USD → KRW 환율 (1달러당 원)
                  <input
                    type="number"
                    min="100"
                    step="0.01"
                    value={draft.usdKrw}
                    disabled={draft.usdKrwMode === "auto"}
                    onChange={(event) =>
                      change({ ...draft, usdKrw: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
            </details>
            <div className={styles.bucketList}>
              {draft.buckets.map((bucket) => {
                const current = values?.values.get(bucket.id) ?? 0;
                const currentPercent = values?.total
                  ? (current / values.total) * 100
                  : 0;
                return (
                  <div className={styles.bucket} key={bucket.id}>
                    <input
                      className={styles.color}
                      type="color"
                      value={bucket.color}
                      aria-label={`${bucket.name} 색상`}
                      onChange={(event) =>
                        editBucket(bucket.id, "color", event.target.value)
                      }
                    />
                    <input
                      className={styles.bucketName}
                      value={bucket.name}
                      aria-label="포트 이름"
                      onChange={(event) =>
                        editBucket(bucket.id, "name", event.target.value)
                      }
                    />
                    <div className={styles.barArea}>
                      <div className={styles.bar}>
                        <i
                          style={{
                            width: `${Math.min(currentPercent, 100)}%`,
                            background: bucket.color,
                          }}
                        />
                      </div>
                      <small>
                        현재 {pct(currentPercent)} · 목표 차이{" "}
                        {currentPercent - bucket.targetPercent > 0 ? "+" : ""}
                        {(currentPercent - bucket.targetPercent).toFixed(1)}%p ·{" "}
                        {fmt(current)}
                      </small>
                    </div>
                    <label>
                      목표{" "}
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={bucket.targetPercent}
                        onChange={(event) =>
                          editBucket(
                            bucket.id,
                            "targetPercent",
                            event.target.value,
                          )
                        }
                      />{" "}
                      %
                    </label>
                    <button
                      className={styles.iconButton}
                      aria-label={`${bucket.name} 삭제`}
                      disabled={draft.buckets.length <= 1}
                      onClick={() => removeBucket(bucket.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <p className={targetTotal === 100 ? styles.ok : styles.warning}>
              목표 합계 {pct(targetTotal)}
              {targetTotal === 100
                ? " · 저장할 수 있습니다."
                : " · 저장하려면 100%로 맞춰 주세요."}
            </p>
          </section>
        </>
      )}
      {(screen === "allocation" || screen === "edit") && (
        <>
          {screen === "allocation" && (
            <div className={styles.vizDisclosure}>
              <div>
                <strong>자산 지도를 더 자세히 보고 싶나요?</strong>
                <span>종목·포트·증권사별 비중을 3D로 탐색할 수 있습니다.</span>
              </div>
              <button
                type="button"
                aria-expanded={show3d}
                onClick={() => setShow3d((value) => !value)}
              >
                {show3d ? "3D 분석 접기" : "3D 분석 열기"}{" "}
                <ChevronDown size={16} />
              </button>
            </div>
          )}
          {screen === "allocation" && show3d && (
            <Portfolio3D portfolio={draft} holdings={holdings} />
          )}

          <details className={`${styles.panel} ${styles.collapsible}`} open>
            <summary className={styles.panelHead}>
              <div>
                <h2>
                  {screen === "allocation"
                    ? "내 자산 배정"
                    : "가상자산·현금 수정"}
                </h2>
              </div>
              <span className={styles.collapseMeta}>
                주식 {holdings.length}개 · 가상자산 {draft.cryptoAssets.length}
                개 · 직접 입력 {draft.manualAssets.length}개{" "}
                <ChevronDown size={16} />
              </span>
            </summary>
            {screen === "allocation" && (
              <>
                <div className={styles.assignmentActions}>
                  <button className={styles.ghost} onClick={onEditHoldings}>
                    <Pencil size={15} /> 자산 수정
                  </button>
                  <button className={styles.ghost} onClick={onImport}>
                    <Camera size={15} /> 캡처 가져오기
                  </button>
                </div>
                {holdings.length ? (
                  <div className={styles.assignmentList}>
                    {holdings.map((holding) => {
                      const assignment = draft.assignments.find(
                        (item) => item.holdingId === holding.id,
                      );
                      const autoBucket =
                        draft.rules.find(
                          (rule) =>
                            rule.market === holding.market &&
                            rule.symbol === holding.symbol,
                        )?.bucketId ?? null;
                      const selection =
                        assignment?.source === "manual"
                          ? (assignment.bucketId ?? "unassigned")
                          : "auto";
                      return (
                        <div key={holding.id}>
                          <div className={styles.assignmentIdentity}>
                            <AssetIcon
                              kind="stock"
                              symbol={holding.symbol}
                              name={holding.name}
                              market={holding.market}
                              exchange={holding.exchange}
                            />
                            <div>
                              <strong>{holding.name}</strong>
                              <small>
                                {holding.broker} ·{" "}
                                {holding.symbol || "코드 미확인"} ·{" "}
                                {fmt(holdingValueKrw(holding, draft.usdKrw))}
                              </small>
                            </div>
                          </div>
                          <select
                            value={selection}
                            aria-label={`${holding.name} 포트 배정`}
                            onChange={(event) =>
                              assign(holding.id, event.target.value)
                            }
                          >
                            <option value="auto">
                              자동{" "}
                              {autoBucket
                                ? `· ${draft.buckets.find((bucket) => bucket.id === autoBucket)?.name}`
                                : "· 미분류"}
                            </option>
                            <option value="unassigned">직접 · 미분류</option>
                            {draft.buckets.map((bucket) => (
                              <option key={bucket.id} value={bucket.id}>
                                직접 · {bucket.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className={styles.help}>
                    보유 종목이 없습니다. 잔고 캡처를 가져오면 이곳에서 포트별로
                    배정할 수 있습니다.
                  </p>
                )}
                {draft.cryptoAssets.map((asset) => (
                  <div className={styles.assignmentAssetRow} key={asset.id}>
                    <div className={styles.assignmentIdentity}>
                      <AssetIcon
                        kind="crypto"
                        symbol={asset.marketCode.replace(/^KRW-/, "")}
                        name={asset.name}
                      />
                      <div>
                        <strong>{asset.name}</strong>
                        <small>
                          {asset.marketCode} ·{" "}
                          {asset.quotedPriceKrw === null
                            ? "시세 미확인"
                            : fmt(cryptoAssetValueKrw(asset))}
                        </small>
                      </div>
                    </div>
                    <select
                      value={asset.bucketId ?? ""}
                      aria-label={`${asset.name} 포트 배정`}
                      onChange={(event) =>
                        change({
                          ...draft,
                          cryptoAssets: draft.cryptoAssets.map((item) =>
                            item.id === asset.id
                              ? {
                                  ...item,
                                  bucketId: event.target.value || null,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="">미분류</option>
                      {draft.buckets.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                {draft.manualAssets.map((asset) => (
                  <div className={styles.assignmentAssetRow} key={asset.id}>
                    <div className={styles.assignmentIdentity}>
                      <AssetIcon
                        kind="cash"
                        symbol={asset.valueUsd === null ? "KRW" : "USD"}
                        name={asset.name}
                      />
                      <div>
                        <strong>{asset.name}</strong>
                        <small>
                          {fmt(manualAssetValueKrw(asset, draft.usdKrw))}
                        </small>
                      </div>
                    </div>
                    <select
                      value={asset.bucketId ?? ""}
                      aria-label={`${asset.name} 포트 배정`}
                      onChange={(event) =>
                        change({
                          ...draft,
                          manualAssets: draft.manualAssets.map((item) =>
                            item.id === asset.id
                              ? {
                                  ...item,
                                  bucketId: event.target.value || null,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="">미분류</option>
                      {draft.buckets.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </>
            )}
            {screen === "edit" && (
              <>
                <div className={styles.subHead}>
                  <h3>가상자산 · 빗썸 원화 시세</h3>
                  <small>
                    원화마켓 코드와 보유 수량을 등록하면 가격 갱신 시 평가액을
                    계산합니다.
                  </small>
                </div>
                <div className={styles.cryptoSearch}>
                  <input
                    value={cryptoQuery}
                    onChange={(event) => setCryptoQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") lookupCrypto();
                    }}
                    placeholder="비트코인 또는 KRW-BTC 검색"
                    aria-label="가상자산 원화마켓 검색"
                  />
                  <button
                    type="button"
                    onClick={lookupCrypto}
                    disabled={lookingUpCrypto}
                  >
                    <Search size={15} /> {lookingUpCrypto ? "검색 중" : "검색"}
                  </button>
                </div>
                {cryptoCandidates.length > 0 && (
                  <div className={styles.cryptoCandidates}>
                    {cryptoCandidates.map((market) => (
                      <button
                        key={market.marketCode}
                        type="button"
                        onClick={() => {
                          setCryptoSelected(market);
                          setCryptoCandidates([]);
                        }}
                      >
                        <strong>{market.name}</strong>
                        <span>
                          {market.marketCode} · {market.englishName}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <div className={styles.cryptoForm}>
                  <span className={styles.cryptoSelection}>
                    {cryptoSelected
                      ? `${cryptoSelected.name} · ${cryptoSelected.marketCode}`
                      : "마켓을 검색해 선택"}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="999999999999"
                    step="0.000000000001"
                    value={cryptoQuantity}
                    onChange={(event) => setCryptoQuantity(event.target.value)}
                    placeholder="보유 수량"
                    aria-label="가상자산 보유 수량"
                  />
                  <input
                    type="number"
                    min="0"
                    max="999999999999"
                    step="any"
                    value={cryptoCost}
                    onChange={(event) => setCryptoCost(event.target.value)}
                    placeholder="코인당 매입가 (원)"
                    aria-label="가상자산 코인당 매입단가 원화"
                  />
                  <select
                    value={
                      cryptoBucketId ||
                      draft.buckets.find((bucket) =>
                        /비트코인|가상자산|코인/i.test(bucket.name),
                      )?.id ||
                      draft.buckets[0]?.id ||
                      ""
                    }
                    onChange={(event) => setCryptoBucketId(event.target.value)}
                    aria-label="가상자산 포트"
                  >
                    {draft.buckets.map((bucket) => (
                      <option key={bucket.id} value={bucket.id}>
                        {bucket.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={addCryptoAsset}>
                    <Plus size={15} /> 추가
                  </button>
                </div>
                {draft.cryptoAssets.map((asset) => (
                  <div
                    className={styles.cryptoRow}
                    id={`edit-crypto-${asset.id}`}
                    key={asset.id}
                  >
                    <div>
                      <strong>{asset.name}</strong>
                      <small>
                        {asset.marketCode} · 빗썸{" "}
                        {asset.quotedPriceKrw === null
                          ? "시세 미확인"
                          : `현재가 ${fmt(asset.quotedPriceKrw)}`}
                      </small>
                      <small>
                        조회 {timeLabel(asset.quoteCheckedAt)}
                        {asset.lastTradeAt
                          ? ` · 마지막 체결 ${timeLabel(asset.lastTradeAt)}`
                          : ""}
                      </small>
                    </div>
                    <label className={styles.cryptoField}>
                      <span>보유 수량</span>
                      <input
                        type="number"
                        min="0"
                        max="999999999999"
                        step="0.000000000001"
                        value={asset.quantity}
                        aria-label={`${asset.name} 보유 수량`}
                        onChange={(event) =>
                          change({
                            ...draft,
                            cryptoAssets: draft.cryptoAssets.map((item) =>
                              item.id === asset.id
                                ? {
                                    ...item,
                                    quantity: Number(event.target.value),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className={styles.cryptoField}>
                      <span>코인당 매입가 (원)</span>
                      <input
                        type="number"
                        min="0"
                        max="999999999999"
                        step="any"
                        value={asset.averageCostKrw ?? ""}
                        aria-label={`${asset.name} 코인당 매입단가 원화`}
                        onChange={(event) =>
                          change({
                            ...draft,
                            cryptoAssets: draft.cryptoAssets.map((item) =>
                              item.id === asset.id
                                ? {
                                    ...item,
                                    averageCostKrw:
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <select
                      value={asset.bucketId ?? ""}
                      aria-label={`${asset.name} 포트`}
                      onChange={(event) =>
                        change({
                          ...draft,
                          cryptoAssets: draft.cryptoAssets.map((item) =>
                            item.id === asset.id
                              ? {
                                  ...item,
                                  bucketId: event.target.value || null,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="">미분류</option>
                      {draft.buckets.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name}
                        </option>
                      ))}
                    </select>
                    <b>
                      {asset.quotedPriceKrw === null
                        ? "가격 미확인"
                        : fmt(cryptoAssetValueKrw(asset))}
                    </b>
                    <button
                      className={styles.iconButton}
                      aria-label={`${asset.name} 삭제`}
                      onClick={() =>
                        change({
                          ...draft,
                          cryptoAssets: draft.cryptoAssets.filter(
                            (item) => item.id !== asset.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <div className={styles.subHead}>
                  <h3>기타 직접 입력 자산</h3>
                  <small>원화 금액이나 달러 수량을 직접 관리하는 자산</small>
                </div>
                {draft.manualAssets.some((asset) =>
                  /비트코인|bitcoin|BTC/i.test(asset.name),
                ) && (
                  <p className={styles.help}>
                    기존 비트코인 직접 입력 금액은 자동 시세와 별개입니다.
                    수량을 등록한 뒤 중복 합산되지 않도록 기존 금액을 확인해
                    주세요.
                  </p>
                )}
                <div className={styles.manualForm}>
                  <input
                    value={manualName}
                    onChange={(event) => setManualName(event.target.value)}
                    placeholder="자산 이름"
                    aria-label="직접 입력 자산 이름"
                  />
                  <input
                    type="number"
                    min="0"
                    value={manualValue}
                    onChange={(event) => setManualValue(event.target.value)}
                    placeholder={
                      manualCurrency === "USD" ? "달러 금액" : "평가액 (원)"
                    }
                    aria-label="직접 입력 자산 금액"
                  />
                  <select
                    value={manualCurrency}
                    onChange={(event) =>
                      setManualCurrency(event.target.value as "KRW" | "USD")
                    }
                    aria-label="직접 입력 자산 통화"
                  >
                    <option value="KRW">원화</option>
                    <option value="USD">달러</option>
                  </select>
                  <select
                    value={manualBucketId}
                    onChange={(event) => setManualBucketId(event.target.value)}
                    aria-label="자산 포트"
                  >
                    <option value="">미분류</option>
                    {draft.buckets.map((bucket) => (
                      <option key={bucket.id} value={bucket.id}>
                        {bucket.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={addManualAsset}>
                    <Plus size={15} /> 추가
                  </button>
                </div>
                {draft.manualAssets.map((asset) => (
                  <div
                    className={styles.manualRow}
                    id={`edit-manual-${asset.id}`}
                    key={asset.id}
                  >
                    <label className={styles.manualNameField}>
                      <span>자산 이름</span>
                      <input
                        value={asset.name}
                        maxLength={100}
                        aria-label={`${asset.name || "직접 입력 자산"} 이름`}
                        onChange={(event) => change({
                          ...draft,
                          manualAssets: draft.manualAssets.map((item) =>
                            item.id === asset.id ? { ...item, name: event.target.value } : item,
                          ),
                        })}
                      />
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="1000000000000000"
                      value={asset.valueUsd ?? asset.valueKrw}
                      aria-label={`${asset.name} ${asset.valueUsd === null ? "원화 평가액" : "달러 금액"}`}
                      onChange={(event) =>
                        change({
                          ...draft,
                          manualAssets: draft.manualAssets.map((item) =>
                            item.id === asset.id
                              ? item.valueUsd === null
                                ? {
                                    ...item,
                                    valueKrw: Number(event.target.value),
                                  }
                                : {
                                    ...item,
                                    valueUsd: Number(event.target.value),
                                    valueKrw:
                                      Number(event.target.value) * draft.usdKrw,
                                  }
                              : item,
                          ),
                        })
                      }
                    />
                    <small>
                      {asset.valueUsd === null
                        ? "KRW"
                        : `USD · ${fmt(manualAssetValueKrw(asset, draft.usdKrw))}`}
                    </small>
                    <select
                      value={asset.bucketId ?? ""}
                      aria-label={`${asset.name} 포트`}
                      onChange={(event) =>
                        change({
                          ...draft,
                          manualAssets: draft.manualAssets.map((item) =>
                            item.id === asset.id
                              ? {
                                  ...item,
                                  bucketId: event.target.value || null,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="">미분류</option>
                      {draft.buckets.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className={styles.iconButton}
                      aria-label={`${asset.name} 삭제`}
                      onClick={() =>
                        change({
                          ...draft,
                          manualAssets: draft.manualAssets.filter(
                            (item) => item.id !== asset.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </details>
          {screen === "edit" && (
            <div className={styles.assetEditorSave}>
              {dirty ? (
                <button
                  className={styles.save}
                  onClick={save}
                  disabled={saving}
                >
                  {saving ? "저장 중" : "가상자산·현금 변경 저장"}
                </button>
              ) : (
                <span className={styles.saved}>
                  <Check size={15} /> 저장됨
                </span>
              )}
            </div>
          )}
        </>
      )}
      {(screen === "allocation" || screen === "edit") && dirty && (
        <div className={styles.mobileSaveBar}>
          <button type="button" onClick={save} disabled={saving}>
            {saving ? "저장 중" : "변경 내용 저장"}
          </button>
        </div>
      )}
      {screen === "rebalance" && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>조정 제안</h2>
              </div>
              <select
                value={rebalanceMode}
                onChange={(event) =>
                  setRebalanceMode(event.target.value as "trade" | "add-only")
                }
                aria-label="리밸런싱 방법"
              >
                <option value="trade">매도 후 매수</option>
                <option value="add-only">신규 자금으로 매수</option>
              </select>
            </div>
            <p className={styles.methodNote}>
              허용 오차 ±{draft.tolerancePercent.toFixed(1)}%p
              <button type="button" onClick={() => onNavigate("strategy")}>기준 변경</button>
              {rebalanceMode === "add-only" && advice.requiredCash > 0
                ? ` · 목표 비중까지 이론상 필요한 신규 자금 약 ${fmt(advice.requiredCash)}`
                : ""}
            </p>
            {rebalanceMode === "add-only" && (
              <label className={styles.cashBudget}>
                이번에 투입할 금액 (원)
                <input
                  type="number"
                  min="0"
                  max="1000000000000000"
                  step="1"
                  value={cashInput}
                  onChange={(event) => setCashInput(event.target.value)}
                  placeholder="비우면 이론상 필요 금액"
                />
              </label>
            )}
            <details className={styles.exclusions}>
              <summary>
                이번 조정에서 제외할 보유 종목 {excludedHoldingIds.length}개{" "}
                <ChevronDown size={14} />
              </summary>
              <div>
                {holdings.map((holding) => (
                  <label key={holding.id}>
                    <input
                      type="checkbox"
                      checked={excludedHoldingIds.includes(holding.id)}
                      onChange={(event) =>
                        setExcludedHoldingIds((ids) =>
                          event.target.checked
                            ? [...ids, holding.id]
                            : ids.filter((id) => id !== holding.id),
                        )
                      }
                    />
                    {holding.broker} · {holding.name} (
                    {holding.symbol || "코드 없음"})
                  </label>
                ))}
                {!holdings.length && (
                  <small>제외할 보유 종목이 없습니다.</small>
                )}
              </div>
            </details>
            <p className={styles.help}>
              예상 수량은 1주 단위이며 수수료·세금·환전 비용은 포함하지
              않습니다. 계좌별 주문 가능 금액도 확인하세요.
            </p>
            {!rebalanceReady ? (
              <div className={styles.rebalanceStatus}>
                <span>
                  {values?.missingPrices
                    ? `가격 미확인 ${values.missingPrices}개 종목을 확인해 주세요.`
                    : values?.unassigned
                      ? `미분류 자산 ${fmt(values.unassigned)}을 배정해 주세요.`
                      : "가격이 있는 자산을 등록하면 추천이 표시됩니다."}
                </span>
                {Boolean(values?.unassigned) && (
                  <button
                    type="button"
                    onClick={() => onNavigate("allocation")}
                  >
                    자산 배정으로 이동 <ArrowRight size={14} />
                  </button>
                )}
              </div>
            ) : (
              <>
                <p className={styles.rebalanceStatus}>
                  {inRangeCount > 0
                    ? `${inRangeCount}개 포트는 허용 오차 안에 있습니다.`
                    : ""}
                  {!actionItems.length ? " 현재 조정할 포트가 없습니다." : ""}
                </p>
                <div className={styles.adviceList}>
                  {actionItems.map((item) => {
                    const itemTrades = advice.trades.filter(
                      (trade) => trade.bucketId === item.bucket.id,
                    );
                    const action = itemTrades.some(
                      (trade) => trade.side === "buy",
                    )
                      ? "add"
                      : itemTrades.some((trade) => trade.side === "sell")
                        ? "sell"
                        : item.gapPercent > 0
                          ? "add"
                          : rebalanceMode === "trade"
                            ? "sell"
                            : "hold";
                    return (
                      <div
                        key={item.bucket.id}
                        className={`${styles.advice} ${action === "add" ? styles.adviceAdd : action === "sell" ? styles.adviceSell : styles.adviceHold}`}
                      >
                        <span
                          className={styles.dot}
                          style={{ background: item.bucket.color }}
                        />
                        <div>
                          <strong>
                            <span className={styles.actionTag}>
                              {action === "add"
                                ? "추가"
                                : action === "sell"
                                  ? "매도"
                                  : "유지"}
                            </span>
                            {item.bucket.name}
                          </strong>
                          <small>
                            목표와 차이 {item.gapPercent > 0 ? "+" : ""}
                            {item.gapPercent.toFixed(1)}%p · 조정 후 예상{" "}
                            {pct(item.projectedPercent)}
                          </small>
                        </div>
                        <p>{item.advice}</p>
                      </div>
                    );
                  })}
                </div>
                <div className={styles.previewSummary}>
                  <strong>조정 후 미리보기</strong>
                  <span>
                    제안{" "}
                    {
                      advice.trades.filter((trade) => trade.side === "buy")
                        .length
                    }
                    건 매수 ·{" "}
                    {
                      advice.trades.filter((trade) => trade.side === "sell")
                        .length
                    }
                    건 매도
                  </span>
                  <span>
                    주식 제안 후 남는 자금 약 {fmt(advice.residualCash)}
                    {advice.projectedUnassignedPercent > 0
                      ? ` · 전체의 ${pct(advice.projectedUnassignedPercent)}`
                      : ""}
                  </span>
                </div>
                {draft.cryptoAssets.length > 0 && (
                  <p className={styles.help}>
                    가상자산 수량 조정은 직접 검토 항목이며 조정 후 예상
                    비중·잔여 자금에는 반영하지 않습니다.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
      {screen === "rebalance" && (
        <>
          <details className={`${styles.panel} ${styles.collapsible} ${styles.candidateSection}`}>
            <summary className={styles.panelHead}>
              <div>
                <h2>매수 후보 종목</h2>
              </div>
              <span className={styles.collapseMeta}>
                등록 {draft.rules.length}개 <ChevronDown size={16} />
              </span>
            </summary>
            <p className={styles.help}>
              매수에 사용할 종목을 포트별로 등록하세요. 등록된 후보와 보유
              종목을 기준으로 위의 조정 수량을 계산합니다.
            </p>
            <div className={styles.ownedRulesHead}>
              <strong>후보 종목 검색</strong>
              <span>아직 보유하지 않은 종목도 추가할 수 있습니다</span>
            </div>
            <div className={styles.ruleForm}>
              <select
                value={ruleBucketId || draft.buckets[0]?.id || ""}
                onChange={(event) => setRuleBucketId(event.target.value)}
                aria-label="배정할 포트"
              >
                {draft.buckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </option>
                ))}
              </select>
              <select
                value={ruleMarket}
                onChange={(event) => {
                  setRuleMarket(event.target.value as Market);
                  setCandidates([]);
                }}
                aria-label="시장"
              >
                <option value="KR">국내</option>
                <option value="US">미국</option>
              </select>
              <input
                value={ruleQuery}
                onChange={(event) => {
                  setRuleQuery(event.target.value);
                  setCandidates([]);
                }}
                placeholder="종목명 또는 종목코드"
                aria-label="종목 검색어"
              />
              <button onClick={lookup} disabled={lookingUp}>
                <Search size={15} /> {lookingUp ? "검색 중" : "KIS 검색"}
              </button>
            </div>
            {candidates.length > 0 && (
              <div className={styles.candidates}>
                {candidates.map((item) => (
                  <button
                    key={`${item.market}:${item.symbol}:${item.exchange}`}
                    onClick={() => addRule(item)}
                  >
                    <strong>{item.name}</strong>
                    <span>
                      {item.symbol} · {item.exchange}
                    </span>
                    <Plus size={14} />
                  </button>
                ))}
              </div>
            )}
            <div className={styles.ownedRulesHead}>
              <strong>등록된 후보</strong>
              <span>{draft.rules.length}개</span>
            </div>
            <div className={styles.rules}>
              {draft.rules.map((rule) => (
                <div key={rule.id} className={styles.rule}>
                  <span
                    className={styles.dot}
                    style={{
                      background:
                        draft.buckets.find(
                          (bucket) => bucket.id === rule.bucketId,
                        )?.color ?? "#aaa",
                    }}
                  />
                  <strong>{rule.name || rule.symbol}</strong>
                  <small>
                    {rule.market} · {rule.symbol}
                  </small>
                  <label className={styles.ruleBucket}>
                    <select
                      value={rule.bucketId}
                      aria-label={`${rule.name || rule.symbol} 배정 포트`}
                      onChange={(event) =>
                        change({
                          ...draft,
                          rules: draft.rules.map((item) =>
                            item.id === rule.id
                              ? { ...item, bucketId: event.target.value }
                              : item,
                          ),
                        })
                      }
                    >
                      {draft.buckets.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <details className={styles.ruleAdvanced}>
                    <summary>
                      임시 가격
                      {rule.manualPrice
                        ? ` ${won.format(rule.manualPrice)}`
                        : ""}
                    </summary>
                    <label>
                      시세가 없을 때 매수 수량 계산용 ·{" "}
                      {rule.market === "KR" ? "원" : "달러"}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={rule.manualPrice ?? ""}
                        placeholder="비워두면 자동 시세 사용"
                        aria-label={`${rule.name || rule.symbol} 임시 가격`}
                        onChange={(event) =>
                          change({
                            ...draft,
                            rules: draft.rules.map(
                              (item): Rule =>
                                item.id === rule.id
                                  ? {
                                      ...item,
                                      manualPrice: event.target.value
                                        ? Number(event.target.value)
                                        : null,
                                    }
                                  : item,
                            ),
                          })
                        }
                      />
                    </label>
                  </details>
                  <button
                    className={styles.iconButton}
                    aria-label={`${rule.symbol} 규칙 삭제`}
                    onClick={() =>
                      change({
                        ...draft,
                        rules: draft.rules.filter(
                          (item) => item.id !== rule.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      {screen === "history" && (
        <>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>포트별 자산 추이</h2>
              </div>
              <button
                className={styles.ghost}
                onClick={record}
                disabled={dirty}
              >
                <Check size={15} /> 오늘 기록
              </button>
            </div>
            <div className={styles.trendControls}>
              <select
                value={trendKey}
                onChange={(event) => setTrendKey(event.target.value)}
                aria-label="추이를 볼 포트"
              >
                <option value="__TOTAL__">전체 자산</option>
                <option value="__UNASSIGNED__">미분류</option>
                {draft.buckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </option>
                ))}
              </select>
              <small>하루 한 기록 · 같은 날에는 최신 값으로 갱신</small>
            </div>
            <Trend points={history} color={trendColor} />
            {trendKey === "__TOTAL__" && (
              <div className={styles.performanceSummary}>
                <div>
                  <small>기록 기간의 평가액 변화</small>
                  <strong>
                    {adjustedChange === null
                      ? "기록 2일 이상 필요"
                      : fmt(
                          (lastPoint?.valueKrw ?? 0) -
                            (firstPoint?.valueKrw ?? 0),
                        )}
                  </strong>
                </div>
                <div>
                  <small>같은 기간 순입금</small>
                  <strong>
                    {adjustedChange === null ? "—" : fmt(periodFlow)}
                  </strong>
                </div>
                <div>
                  <small>순입금 제외 증감</small>
                  <strong>
                    {adjustedChange === null ? "—" : fmt(adjustedChange)}
                  </strong>
                </div>
                <p>
                  순입금 제외 증감은 평가액 변화에서 기록한 입출금을 뺀
                  참고값입니다. 신규 자산 등록·수량 수정, 배당·수수료·환율
                  변동도 영향을 줍니다. 투자 수익률은 아닙니다.
                </p>
              </div>
            )}
            <details className={styles.flowDetails}>
              <summary>
                입출금 기록 {draft.cashFlows.length}건 <ChevronDown size={15} />
              </summary>
              <p className={styles.help}>
                계좌 밖에서 들어오거나 나간 자금만 기록하세요. 계좌 간 이동은
                합산 범위에 따라 중복되지 않게 입력해야 합니다.
              </p>
              <div className={styles.flowForm}>
                <input
                  type="date"
                  value={flowDate}
                  onChange={(event) => setFlowDate(event.target.value)}
                  aria-label="입출금 날짜"
                />
                <select
                  value={flowKind}
                  onChange={(event) =>
                    setFlowKind(event.target.value as "deposit" | "withdrawal")
                  }
                  aria-label="입출금 구분"
                >
                  <option value="deposit">입금</option>
                  <option value="withdrawal">출금</option>
                </select>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={flowAmount}
                  onChange={(event) => setFlowAmount(event.target.value)}
                  placeholder="금액 (원)"
                  aria-label="입출금 금액"
                />
                <input
                  value={flowNote}
                  onChange={(event) => setFlowNote(event.target.value)}
                  maxLength={120}
                  placeholder="메모 (선택)"
                  aria-label="입출금 메모"
                />
                <button
                  type="button"
                  onClick={saveFlow}
                  disabled={flowSaving || dirty}
                >
                  {flowSaving ? "저장 중" : "기록"}
                </button>
              </div>
              <div className={styles.flowList}>
                {draft.cashFlows.map((flow) => (
                  <div key={flow.id}>
                    <span>
                      {flow.date} ·{" "}
                      {flow.note || (flow.amountKrw > 0 ? "입금" : "출금")}
                    </span>
                    <strong>
                      {flow.amountKrw > 0 ? "+" : ""}
                      {fmt(flow.amountKrw)}
                    </strong>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => removeFlow(flow.id)}
                      disabled={dirty}
                      aria-label={`${flow.date} 입출금 삭제`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {!draft.cashFlows.length && (
                  <small>기록된 입출금이 없습니다.</small>
                )}
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
