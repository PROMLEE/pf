import { NextResponse } from "next/server";
import type { Portfolio } from "../../portfolio-model";
import { currentUserId } from "../../../lib/auth";
import {
  listPortfolio,
  listCryptoAssets,
  recordSnapshot,
  savePortfolio,
} from "../../../lib/portfolio-db";
import { fetchUsdKrwReference } from "../../../lib/fx";
import {
  listKrwCryptoMarkets,
  refreshStoredCryptoQuotes,
} from "../../../lib/bithumb";

export const runtime = "nodejs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function valid(input: Portfolio) {
  if (!input || typeof input !== "object") return false;
  if (
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.title.length > 80
  )
    return false;
  if (
    typeof input.usdKrw !== "number" ||
    !Number.isFinite(input.usdKrw) ||
    input.usdKrw < 100 ||
    input.usdKrw > 100000
  )
    return false;
  if (
    !["auto", "manual"].includes(input.usdKrwMode) ||
    (input.usdKrwRateDate !== null &&
      (typeof input.usdKrwRateDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.usdKrwRateDate)))
  )
    return false;
  if (
    typeof input.tolerancePercent !== "number" ||
    !Number.isFinite(input.tolerancePercent) ||
    input.tolerancePercent < 0 ||
    input.tolerancePercent > 30
  )
    return false;
  if (
    !Array.isArray(input.buckets) ||
    input.buckets.length < 1 ||
    input.buckets.length > 20
  )
    return false;
  if (!Array.isArray(input.rules) || input.rules.length > 100) return false;
  if (!Array.isArray(input.manualAssets) || input.manualAssets.length > 100)
    return false;
  if (!Array.isArray(input.cryptoAssets) || input.cryptoAssets.length > 100)
    return false;
  if (!Array.isArray(input.assignments) || input.assignments.length > 500)
    return false;

  const bucketIds = new Set<string>();
  const bucketNames = new Set<string>();
  let target = 0;
  for (const bucket of input.buckets) {
    if (!uuid.test(bucket.id) || bucketIds.has(bucket.id)) return false;
    if (
      typeof bucket.name !== "string" ||
      !bucket.name.trim() ||
      bucket.name.length > 60
    )
      return false;
    const nameKey = bucket.name.trim().toLocaleLowerCase("ko-KR");
    if (bucketNames.has(nameKey)) return false;
    if (
      typeof bucket.targetPercent !== "number" ||
      !Number.isFinite(bucket.targetPercent) ||
      bucket.targetPercent < 0 ||
      bucket.targetPercent > 100
    )
      return false;
    if (
      typeof bucket.color !== "string" ||
      !/^#[0-9a-f]{6}$/i.test(bucket.color)
    )
      return false;
    bucketIds.add(bucket.id);
    bucketNames.add(nameKey);
    target += bucket.targetPercent;
  }
  if (Math.abs(target - 100) > 0.01) return false;

  const ruleIds = new Set<string>();
  const ruleSymbols = new Set<string>();
  for (const rule of input.rules) {
    if (
      !uuid.test(rule.id) ||
      ruleIds.has(rule.id) ||
      !bucketIds.has(rule.bucketId)
    )
      return false;
    if (
      !(
        (rule.market === "KR" &&
          /^[0-9A-Z]{6}$/.test(rule.symbol) &&
          (rule.exchange == null ||
            ["KOSPI", "KOSDAQ"].includes(rule.exchange))) ||
        (rule.market === "US" &&
          /^[A-Z.]{1,10}$/.test(rule.symbol) &&
          (rule.exchange == null ||
            ["NAS", "NYS", "AMS"].includes(rule.exchange)))
      )
    )
      return false;
    if (typeof rule.name !== "string" || rule.name.length > 200) return false;
    if (
      rule.manualPrice != null &&
      (typeof rule.manualPrice !== "number" ||
        !Number.isFinite(rule.manualPrice) ||
        rule.manualPrice <= 0 ||
        rule.manualPrice > 1e12)
    )
      return false;
    const key = `${rule.market}:${rule.symbol}`;
    if (ruleSymbols.has(key)) return false;
    ruleIds.add(rule.id);
    ruleSymbols.add(key);
  }

  const assetIds = new Set<string>();
  for (const asset of input.manualAssets) {
    if (!uuid.test(asset.id) || assetIds.has(asset.id)) return false;
    if (asset.bucketId !== null && !bucketIds.has(asset.bucketId)) return false;
    if (
      typeof asset.name !== "string" ||
      !asset.name.trim() ||
      asset.name.length > 100
    )
      return false;
    if (
      typeof asset.valueKrw !== "number" ||
      !Number.isFinite(asset.valueKrw) ||
      asset.valueKrw < 0 ||
      asset.valueKrw > 1e15
    )
      return false;
    if (
      asset.valueUsd !== null &&
      (typeof asset.valueUsd !== "number" ||
        !Number.isFinite(asset.valueUsd) ||
        asset.valueUsd < 0 ||
        asset.valueUsd > 1e12 ||
        Math.abs(asset.valueUsd - Math.round(asset.valueUsd * 1e6) / 1e6) >
          1e-9)
    )
      return false;
    assetIds.add(asset.id);
  }

  const cryptoCodes = new Set<string>();
  for (const asset of input.cryptoAssets) {
    if (!uuid.test(asset.id) || assetIds.has(asset.id)) return false;
    if (asset.bucketId !== null && !bucketIds.has(asset.bucketId)) return false;
    if (
      !/^KRW-[A-Z0-9]{2,20}$/.test(asset.marketCode) ||
      cryptoCodes.has(asset.marketCode)
    )
      return false;
    if (
      typeof asset.name !== "string" ||
      !asset.name.trim() ||
      asset.name.length > 100
    )
      return false;
    if (
      typeof asset.quantity !== "number" ||
      !Number.isFinite(asset.quantity) ||
      asset.quantity <= 0 ||
      asset.quantity >= 1e12 ||
      Math.round(asset.quantity * 1e12) !== asset.quantity * 1e12
    )
      return false;
    assetIds.add(asset.id);
    cryptoCodes.add(asset.marketCode);
  }

  const holdingIds = new Set<string>();
  for (const assignment of input.assignments) {
    if (
      !uuid.test(assignment.holdingId) ||
      holdingIds.has(assignment.holdingId)
    )
      return false;
    if (assignment.bucketId !== null && !bucketIds.has(assignment.bucketId))
      return false;
    if (assignment.source !== "auto" && assignment.source !== "manual")
      return false;
    holdingIds.add(assignment.holdingId);
  }
  return true;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  try {
    return NextResponse.json({ portfolio: await listPortfolio(userId) });
  } catch {
    return NextResponse.json(
      { message: "포트폴리오를 불러오지 못했습니다" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  try {
    const input = (await request.json()) as Portfolio;
    if (!valid(input))
      return NextResponse.json(
        {
          message:
            "목표 비중·종목 규칙·자산 정보를 확인해 주세요. 목표 합계는 100%여야 합니다.",
        },
        { status: 400 },
      );
    let fxWarning: string | null = null;
    if (input.usdKrwMode === "auto") {
      try {
        const reference = await fetchUsdKrwReference();
        const previous = await listPortfolio(userId);
        if (
          previous?.usdKrwRateDate &&
          previous.usdKrwRateDate > reference.date
        ) {
          input.usdKrw = previous.usdKrw;
          input.usdKrwRateDate = previous.usdKrwRateDate;
        } else {
          input.usdKrw = reference.rate;
          input.usdKrwRateDate = reference.date;
        }
      } catch {
        const previous = await listPortfolio(userId);
        if (previous) {
          input.usdKrw = previous.usdKrw;
          input.usdKrwRateDate = previous.usdKrwRateDate;
        }
        fxWarning = "자동 환율 조회에 실패해 마지막 저장 환율을 유지했습니다.";
      }
    } else input.usdKrwRateDate = null;
    const existingCodes = new Set(await listCryptoAssets(userId));
    const newCodes = input.cryptoAssets
      .map((asset) => asset.marketCode)
      .filter((code) => !existingCodes.has(code));
    if (newCodes.length) {
      const markets = new Map(
        (await listKrwCryptoMarkets()).map((market) => [
          market.marketCode,
          market.name,
        ]),
      );
      if (newCodes.some((code) => !markets.has(code)))
        return NextResponse.json(
          { message: "빗썸에서 지원하는 원화마켓 코드를 선택해 주세요" },
          { status: 400 },
        );
      input.cryptoAssets = input.cryptoAssets.map((asset) => ({
        ...asset,
        name: markets.get(asset.marketCode) ?? asset.name,
      }));
    }
    let portfolio = await savePortfolio(userId, input);
    let quoteWarning: string | null = null;
    if (input.cryptoAssets.length) {
      try {
        const quotes = await refreshStoredCryptoQuotes(userId);
        if (quotes.some((quote) => quote.price === null))
          quoteWarning =
            "포트폴리오는 저장했지만 일부 가상자산 시세는 확인하지 못했습니다. 마켓 코드를 확인해 주세요.";
        await recordSnapshot(userId);
        portfolio = await listPortfolio(userId);
      } catch {
        quoteWarning =
          "포트폴리오는 저장했지만 가상자산 시세는 갱신하지 못했습니다. 가격 갱신을 다시 눌러 주세요.";
      }
    }
    return NextResponse.json({ portfolio, quoteWarning, fxWarning });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "포트폴리오를 저장하지 못했습니다",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId)
    return NextResponse.json(
      { message: "로그인이 필요합니다" },
      { status: 401 },
    );
  if (!sameOrigin(request))
    return NextResponse.json(
      { message: "허용되지 않은 요청입니다" },
      { status: 403 },
    );
  try {
    await recordSnapshot(userId);
    return NextResponse.json({ portfolio: await listPortfolio(userId) });
  } catch {
    return NextResponse.json(
      { message: "오늘의 기록을 저장하지 못했습니다" },
      { status: 500 },
    );
  }
}
