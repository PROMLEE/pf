"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import type { Holding, Market } from "./holdings";
import Portfolio3D from "./Portfolio3D";
import PortfolioVisuals from "./PortfolioVisuals";
import {
  EXAMPLE_BUCKETS,
  EXAMPLE_RULES,
  holdingValueKrw,
  portfolioValues,
  type Bucket,
  type Portfolio,
  type Rule,
} from "./portfolio-model";
import styles from "./portfolio.module.css";

type Candidate = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string | null;
};
type Props = {
  holdings: Holding[];
  quoteVersion: number;
  onHoldings: (rows: Holding[]) => void;
  onNotice: (message: string) => void;
  onRefreshQuotes: () => Promise<void>;
  onImport: () => void;
};
const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const fmt = (value: number) => `${won.format(value)}원`;
const pct = (value: number) => `${value.toFixed(1)}%`;
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
    tolerancePercent: 5,
    buckets: [],
    rules: [],
    manualAssets: [],
    assignments: [],
    snapshots: [],
  };
}

function bucketFor(holding: Holding, plan: Portfolio) {
  const assignment = plan.assignments.find(
    (item) => item.holdingId === holding.id,
  );
  return assignment?.source === "manual"
    ? assignment.bucketId
    : (plan.rules.find(
        (rule) =>
          rule.market === holding.market && rule.symbol === holding.symbol,
      )?.bucketId ?? null);
}

function needsAdjustment(
  target: number,
  current: number,
  currentPercent: number,
  tolerance: number,
) {
  return (
    (target > 0 && current === 0) ||
    Math.abs(target - currentPercent) > tolerance
  );
}

function suggestions(
  plan: Portfolio,
  holdings: Holding[],
  mode: "trade" | "add-only",
) {
  const { values, unassigned, total, missingPrices } = portfolioValues(
    plan,
    holdings,
  );
  const withinRange = plan.buckets.every((bucket) => {
    const currentPercent =
      total > 0 ? ((values.get(bucket.id) ?? 0) / total) * 100 : 0;
    return !needsAdjustment(
      bucket.targetPercent,
      values.get(bucket.id) ?? 0,
      currentPercent,
      plan.tolerancePercent,
    );
  });
  const impossibleWithoutSelling =
    mode === "add-only" &&
    !withinRange &&
    plan.buckets.some(
      (bucket) =>
        bucket.targetPercent === 0 && (values.get(bucket.id) ?? 0) > 0,
    );
  const targetTotal =
    mode === "add-only" &&
    !withinRange &&
    !impossibleWithoutSelling &&
    unassigned === 0 &&
    missingPrices === 0
      ? Math.max(
          total,
          ...plan.buckets
            .filter((bucket) => bucket.targetPercent > 0)
            .map(
              (bucket) =>
                (values.get(bucket.id) ?? 0) / (bucket.targetPercent / 100),
            ),
        )
      : total;
  const items = plan.buckets.map((bucket) => {
    const current = values.get(bucket.id) ?? 0;
    const currentPercent = total > 0 ? (current / total) * 100 : 0;
    const gapPercent = bucket.targetPercent - currentPercent;
    const gap = (targetTotal * bucket.targetPercent) / 100 - current;
    if (total <= 0)
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: "가격이 있는 자산을 등록하면 추천이 표시됩니다.",
      };
    if (missingPrices > 0)
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: `가격이 없는 보유 종목 ${missingPrices}개를 먼저 확인하세요.`,
      };
    if (unassigned > 0)
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: "미분류 자산을 먼저 포트에 배정하세요.",
      };
    if (impossibleWithoutSelling)
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: "목표 0%인 자산이 있어 매도 없는 조정은 불가능합니다.",
      };
    if (
      !needsAdjustment(
        bucket.targetPercent,
        current,
        currentPercent,
        plan.tolerancePercent,
      )
    )
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: "설정한 허용 오차 안에 있습니다.",
      };
    if (mode === "add-only" && gap <= 0)
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: "신규 매수 없이 현재 수량을 유지하세요.",
      };

    const owned = holdings
      .filter((row) => bucketFor(row, plan) === bucket.id)
      .filter((row) => (row.currentPrice ?? row.capturedPrice) !== null);
    if (mode === "trade" && gap < 0) {
      let remaining = -gap;
      const steps: string[] = [];
      for (const holding of [...owned].sort(
        (a, b) =>
          holdingValueKrw(b, plan.usdKrw) - holdingValueKrw(a, plan.usdKrw),
      )) {
        const unit =
          (holding.currentPrice ?? holding.capturedPrice ?? 0) *
          (holding.market === "US" ? plan.usdKrw : 1);
        if (unit <= 0) continue;
        const shares = Math.min(
          Math.floor(holding.quantity),
          Math.floor(remaining / unit),
        );
        if (shares > 0) {
          steps.push(`${holding.symbol || holding.name} ${shares}주 매도`);
          remaining -= shares * unit;
        }
      }
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: steps.length
          ? steps.join(" · ")
          : plan.manualAssets.some((asset) => asset.bucketId === bucket.id)
            ? `약 ${fmt(-gap)} 초과 · 직접 입력 자산의 매도 금액을 검토하세요.`
            : `약 ${fmt(-gap)} 초과 · 매도 가능한 1주 단위가 없습니다.`,
      };
    }

    const rule = plan.rules.find(
      (item) =>
        item.bucketId === bucket.id &&
        (item.manualPrice ??
          item.quotedPrice ??
          owned.find((holding) => holding.symbol === item.symbol)
            ?.currentPrice ??
          owned.find((holding) => holding.symbol === item.symbol)
            ?.capturedPrice),
    );
    if (!rule)
      return {
        bucket,
        current,
        currentPercent,
        gapPercent,
        advice: /현금|RP|CMA/i.test(bucket.name)
          ? `약 ${fmt(gap)}을 현금·RP로 보유하고, 실제 잔액을 직접 입력하세요.`
          : /비트코인|코인/i.test(bucket.name)
            ? `약 ${fmt(gap)} 부족 · 거래소 보유액을 직접 입력하세요.`
            : plan.manualAssets.some((asset) => asset.bucketId === bucket.id)
              ? `약 ${fmt(gap)} 부족 · 직접 입력 자산의 매수 금액을 검토하세요.`
              : `약 ${fmt(gap)} 부족 · 매수할 종목을 지정하거나 직접 입력 자산을 추가하세요.`,
      };
    const matchingHolding = owned.find(
      (holding) => holding.symbol === rule.symbol,
    );
    const unit =
      (rule.manualPrice ??
        rule.quotedPrice ??
        matchingHolding?.currentPrice ??
        matchingHolding?.capturedPrice ??
        0) * (rule.market === "US" ? plan.usdKrw : 1);
    const shares = Math.floor(gap / unit);
    return {
      bucket,
      current,
      currentPercent,
      gapPercent,
      advice:
        shares > 0
          ? `${rule.symbol} ${shares}주 매수 · 예상 ${fmt(shares * unit)}`
          : `약 ${fmt(gap)} 부족 · 선택 종목 1주 미만입니다.`,
    };
  });
  return {
    items,
    requiredCash:
      mode === "add-only" &&
      !withinRange &&
      !impossibleWithoutSelling &&
      unassigned === 0 &&
      missingPrices === 0
        ? Math.max(0, targetTotal - total)
        : 0,
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

export default function PortfolioBuilder({
  holdings,
  quoteVersion,
  onHoldings,
  onNotice,
  onRefreshQuotes,
  onImport,
}: Props) {
  const [draft, setDraft] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ruleMarket, setRuleMarket] = useState<Market>("KR");
  const [ruleQuery, setRuleQuery] = useState("");
  const [ruleBucketId, setRuleBucketId] = useState("");
  const [rulePrice, setRulePrice] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [manualBucketId, setManualBucketId] = useState("");
  const [trendKey, setTrendKey] = useState("__TOTAL__");
  const [show3d, setShow3d] = useState(false);
  const [rebalanceMode, setRebalanceMode] = useState<"trade" | "add-only">(
    "trade",
  );

  useEffect(() => {
    let active = true;
    fetch("/api/portfolio", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          portfolio?: Portfolio;
          message?: string;
        };
        if (!response.ok)
          throw new Error(
            payload.message || "포트폴리오를 불러오지 못했습니다.",
          );
        return payload.portfolio ?? null;
      })
      .then((portfolio) => {
        if (active && !dirty) setDraft(portfolio);
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
    const price = rulePrice.trim() ? Number(rulePrice) : null;
    if (price !== null && (!Number.isFinite(price) || price <= 0))
      return onNotice("기준 가격을 확인해 주세요.");
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
          manualPrice: price,
          quotedPrice: null,
          quoteCheckedAt: null,
        },
      ],
    });
    setCandidates([]);
    setRuleQuery("");
    setRulePrice("");
    onNotice(
      `${candidate.name} 종목을 자동 배정 규칙에 추가했습니다. 저장하면 같은 코드의 보유 종목이 배정됩니다.`,
    );
  }
  function addManualAsset() {
    if (!draft || !manualName.trim())
      return onNotice("수동 자산 이름을 입력해 주세요.");
    const value = Number(manualValue);
    if (!Number.isFinite(value) || value < 0)
      return onNotice("평가금액을 확인해 주세요.");
    change({
      ...draft,
      manualAssets: [
        ...draft.manualAssets,
        {
          id: crypto.randomUUID(),
          bucketId: manualBucketId || null,
          name: manualName.trim(),
          valueKrw: value,
        },
      ],
    });
    setManualName("");
    setManualValue("");
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
    const total = draft.buckets.reduce(
      (sum, bucket) => sum + bucket.targetPercent,
      0,
    );
    if (Math.abs(total - 100) > 0.01)
      return onNotice(
        `목표 비중 합계가 ${pct(total)}입니다. 100%로 맞춰 주세요.`,
      );
    setSaving(true);
    try {
      const response = await fetch("/api/portfolio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as {
        portfolio?: Portfolio;
        message?: string;
      };
      if (!response.ok || !payload.portfolio)
        throw new Error(payload.message || "저장하지 못했습니다.");
      setDraft(payload.portfolio);
      setDirty(false);
      const holdingsResponse = await fetch("/api/holdings", {
        cache: "no-store",
      });
      if (holdingsResponse.ok)
        onHoldings(
          ((await holdingsResponse.json()) as { holdings: Holding[] }).holdings,
        );
      onNotice("포트폴리오와 오늘의 평가액을 저장했습니다.");
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
      onNotice("오늘의 자산 평가액을 기록했습니다.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "기록하지 못했습니다.");
    }
  }

  const values = useMemo(
    () => (draft ? portfolioValues(draft, holdings) : null),
    [draft, holdings],
  );
  const advice = useMemo(
    () =>
      draft
        ? suggestions(draft, holdings, rebalanceMode)
        : { items: [], requiredCash: 0 },
    [draft, holdings, rebalanceMode],
  );
  const rebalanceReady = Boolean(
    values &&
      values.total > 0 &&
      values.unassigned === 0 &&
      values.missingPrices === 0,
  );
  const actionItems = rebalanceReady
    ? advice.items.filter((item) =>
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
        <a className={styles.startQuote} href="https://www.berkshirehathaway.com/letters/2013ltr.pdf" target="_blank" rel="noreferrer">
          “가격은 지불하는 것, 가치는 얻는 것.” <span>— 벤저민 그레이엄</span>
        </a>
      </div>
    );

  return (
    <div className={styles.builder}>
      <div className={styles.heading}>
        <div>
          <span>MY PORTFOLIO</span>
          <h1>내 포트폴리오</h1>
          <p>{draft.title}</p>
        </div>
        <div>
          <button
            className={styles.ghost}
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw size={16} /> {refreshing ? "갱신 중" : "가격 갱신"}
          </button>
          {dirty ? (
            <button className={styles.save} onClick={save} disabled={saving}>
              {saving ? "저장 중" : "변경 내용 저장"}
            </button>
          ) : (
            <span className={styles.saved}>
              <Check size={15} /> 저장됨
            </span>
          )}
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <section className={styles.totalCard}>
          <small>총 평가액</small>
          <strong>{fmt(values?.total ?? 0)}</strong>
          <span>
            {holdings.length}개 보유 항목 · {draft.buckets.length}개 포트
            {(values?.unassigned ?? 0) > 0
              ? ` · 미분류 ${fmt(values?.unassigned ?? 0)}`
              : ""}
            {(values?.missingPrices ?? 0) > 0
              ? ` · 가격 미확인 ${values?.missingPrices}개`
              : ""}
          </span>
        </section>
        <PortfolioVisuals portfolio={draft} holdings={holdings} />
      </div>

      <div className={styles.vizDisclosure}>
        <div>
          <strong>자산 지도를 더 자세히 보고 싶나요?</strong>
          <span>종목·포트·증권사별 비중을 3D로 탐색할 수 있습니다.</span>
        </div>
        <button type="button" aria-expanded={show3d} onClick={() => setShow3d((value) => !value)}>
          {show3d ? "3D 분석 접기" : "3D 분석 열기"} <ChevronDown size={16} />
        </button>
      </div>
      {show3d && <Portfolio3D portfolio={draft} holdings={holdings} />}

      <div className={styles.quoteStrip}>
        <span>INVESTMENT PRINCIPLE</span>
        <p>“가격은 지불하는 것, 가치는 얻는 것.”</p>
        <a href="https://www.berkshirehathaway.com/letters/2013ltr.pdf" target="_blank" rel="noreferrer">벤저민 그레이엄 ↗</a>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <span>01 · STRATEGY</span>
            <h2>목표 비중 편집</h2>
          </div>
          <button className={styles.ghost} onClick={addBucket}>
            <Plus size={16} /> 포트 추가
          </button>
        </div>
        <details className={styles.advancedSettings}>
          <summary>
            계산 기준{" "}
            <span>
              USD {won.format(draft.usdKrw)}원 · 허용 오차 ±
              {pct(draft.tolerancePercent)}
            </span>
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
              USD → KRW 기준환율
              <input
                type="number"
                min="100"
                step="0.01"
                value={draft.usdKrw}
                onChange={(event) =>
                  change({ ...draft, usdKrw: Number(event.target.value) })
                }
              />
            </label>
            <label>
              허용 오차 ±%
              <input
                type="number"
                min="0"
                max="30"
                step="0.1"
                value={draft.tolerancePercent}
                onChange={(event) =>
                  change({
                    ...draft,
                    tolerancePercent: Number(event.target.value),
                  })
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
                    현재 {pct(currentPercent)} · {fmt(current)}
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
                      editBucket(bucket.id, "targetPercent", event.target.value)
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

      <details className={`${styles.panel} ${styles.collapsible}`}>
        <summary className={styles.panelHead}>
          <div>
            <span>02 · INSTRUMENTS</span>
            <h2>종목코드별 자동 배정</h2>
          </div>
          <span className={styles.collapseMeta}>
            {draft.rules.length}개 규칙 <ChevronDown size={16} />
          </span>
        </summary>
        <p className={styles.help}>
          종목코드가 일치하는 보유 종목을 저장할 때 자동으로 분류합니다. 국내
          기준가는 원, 미국 기준가는 달러입니다. 원하는 종목은 아래에서 직접
          다른 포트로 옮길 수 있습니다.
        </p>
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
          <input
            type="number"
            min="0"
            step="any"
            value={rulePrice}
            onChange={(event) => setRulePrice(event.target.value)}
            placeholder="기준 가격(선택)"
            aria-label="기준 가격"
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
        <div className={styles.rules}>
          {draft.rules.map((rule) => (
            <div key={rule.id} className={styles.rule}>
              <span
                className={styles.dot}
                style={{
                  background:
                    draft.buckets.find((bucket) => bucket.id === rule.bucketId)
                      ?.color ?? "#aaa",
                }}
              />
              <strong>{rule.name || rule.symbol}</strong>
              <small>
                {rule.market} · {rule.symbol} ·{" "}
                {
                  draft.buckets.find((bucket) => bucket.id === rule.bucketId)
                    ?.name
                }
              </small>
              <label>
                기준가{" "}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={rule.manualPrice ?? ""}
                  placeholder={
                    rule.quotedPrice ? String(rule.quotedPrice) : "미입력"
                  }
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
              <button
                className={styles.iconButton}
                aria-label={`${rule.symbol} 규칙 삭제`}
                onClick={() =>
                  change({
                    ...draft,
                    rules: draft.rules.filter((item) => item.id !== rule.id),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </details>

      <details className={`${styles.panel} ${styles.collapsible}`}>
        <summary className={styles.panelHead}>
          <div>
            <span>03 · ACTUAL POSITIONS</span>
            <h2>내 자산 배정</h2>
          </div>
          <span className={styles.collapseMeta}>
            {holdings.length}개 보유 · 직접 입력 {draft.manualAssets.length}개{" "}
            <ChevronDown size={16} />
          </span>
        </summary>
        <div className={styles.assignmentActions}>
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
                  <div>
                    <strong>{holding.name}</strong>
                    <small>
                      {holding.broker} · {holding.symbol || "코드 미확인"} ·{" "}
                      {fmt(holdingValueKrw(holding, draft.usdKrw))}
                    </small>
                  </div>
                  <select
                    value={selection}
                    aria-label={`${holding.name} 포트 배정`}
                    onChange={(event) => assign(holding.id, event.target.value)}
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
            보유 종목이 없습니다. 잔고 캡처를 가져오면 이곳에서 포트별로 배정할
            수 있습니다.
          </p>
        )}
        <div className={styles.subHead}>
          <h3>직접 입력 자산</h3>
          <small>비트코인·현금 등 증권사 캡처에 없는 자산</small>
        </div>
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
            placeholder="평가액 (원)"
            aria-label="직접 입력 평가액"
          />
          <select
            value={manualBucketId || draft.buckets[0]?.id || ""}
            onChange={(event) => setManualBucketId(event.target.value)}
            aria-label="자산 포트"
          >
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
          <div className={styles.manualRow} key={asset.id}>
            <strong>{asset.name}</strong>
            <input
              type="number"
              min="0"
              value={asset.valueKrw}
              aria-label={`${asset.name} 평가액`}
              onChange={(event) =>
                change({
                  ...draft,
                  manualAssets: draft.manualAssets.map((item) =>
                    item.id === asset.id
                      ? { ...item, valueKrw: Number(event.target.value) }
                      : item,
                  ),
                })
              }
            />
            <select
              value={asset.bucketId ?? ""}
              aria-label={`${asset.name} 포트`}
              onChange={(event) =>
                change({
                  ...draft,
                  manualAssets: draft.manualAssets.map((item) =>
                    item.id === asset.id
                      ? { ...item, bucketId: event.target.value || null }
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
      </details>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <span>04 · REBALANCE</span>
            <h2>리밸런싱</h2>
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
          허용 오차 ±{pct(draft.tolerancePercent)}
          {rebalanceMode === "add-only" && advice.requiredCash > 0
            ? ` · 목표 비중까지 필요한 신규 자금 약 ${fmt(advice.requiredCash)}`
            : ""}
        </p>
        <p className={styles.help}>
          예상 수량입니다. 주문 전 호가·수수료·가용 현금을 확인하세요.
        </p>
        {!rebalanceReady ? (
          <p className={styles.rebalanceStatus}>
            {values?.missingPrices
              ? `가격 미확인 ${values.missingPrices}개 종목을 확인해 주세요.`
              : values?.unassigned
                ? `미분류 자산 ${fmt(values.unassigned)}을 배정해 주세요.`
                : "가격이 있는 자산을 등록하면 추천이 표시됩니다."}
          </p>
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
                const action =
                  item.gapPercent > 0
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
                        {item.gapPercent.toFixed(1)}%p
                      </small>
                    </div>
                    <p>{item.advice}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <span>05 · HISTORY</span>
            <h2>자산 추이</h2>
          </div>
          <button className={styles.ghost} onClick={record} disabled={dirty}>
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
      </section>
    </div>
  );
}
