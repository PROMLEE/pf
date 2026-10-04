import AdmZip from "adm-zip";
import type { Market } from "../app/holdings";

const BASE =
  process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";
const MASTER_BASE = "https://new.real.download.dws.co.kr/common/master";
const KOREAN_DECODER = new TextDecoder("euc-kr");

export type Instrument = {
  market: Market;
  symbol: string;
  name: string;
  exchange: string | null;
};
export type KisQuote = {
  market: Market;
  symbol: string;
  exchange: string | null;
  price: number | null;
  currency: "KRW" | "USD";
  checkedAt: string | null;
  label: string;
  error?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
let masterCache: { instruments: Instrument[]; expiresAt: number } | null = null;
let nextQuoteAt = 0;
let quoteQueue: Promise<void> = Promise.resolve();

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function paceQuoteRequest() {
  const turn = quoteQueue.then(async () => {
    await wait(Math.max(0, nextQuoteAt - Date.now()));
    nextQuoteAt = Date.now() + 600;
  });
  quoteQueue = turn.catch(() => {});
  await turn;
}

function normalize(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[\s()[\]{}.,…·ㆍ-]/g, "");
}

function configured() {
  return Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

function requireConfiguration() {
  if (!configured())
    throw new Error(
      "한국투자증권 API 설정이 필요합니다. apps/web/.env.local을 확인하세요.",
    );
}

async function token() {
  requireConfiguration();
  if (cachedToken && cachedToken.expiresAt > Date.now())
    return cachedToken.value;
  const response = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    msg1?: string;
  };
  if (!response.ok || !payload.access_token)
    throw new Error(
      payload.msg1 || `한국투자증권 토큰 발급 실패 (${response.status})`,
    );
  cachedToken = {
    value: payload.access_token,
    expiresAt:
      Date.now() + Math.max(60, (payload.expires_in ?? 3600) - 60) * 1000,
  };
  return cachedToken.value;
}

async function kisGet(
  path: string,
  trId: string,
  params: Record<string, string>,
) {
  const url = new URL(path, BASE);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );
  const accessToken = await token();
  for (let attempt = 0; attempt < 3; attempt++) {
    await paceQuoteRequest();
    const response = await fetch(url, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${accessToken}`,
        appkey: process.env.KIS_APP_KEY!,
        appsecret: process.env.KIS_APP_SECRET!,
        tr_id: trId,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      rt_cd?: string;
      msg_cd?: string;
      msg1?: string;
      output?: Record<string, unknown>;
    };
    if (response.ok && payload.rt_cd === "0") return payload.output ?? {};
    const rateLimited =
      payload.msg_cd === "EGW00201" ||
      payload.msg1?.includes("초당 거래건수");
    if (rateLimited && attempt < 2) {
      await wait(1000 * (attempt + 1));
      continue;
    }
    throw new Error(
      payload.msg1 || `한국투자증권 시세 요청 실패 (${response.status})`,
    );
  }
  throw new Error("한국투자증권 시세 요청 재시도 실패");
}

async function downloadMaster(name: string) {
  const response = await fetch(`${MASTER_BASE}/${name}.zip`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`종목 마스터 파일을 받지 못했습니다 (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000)
    throw new Error("종목 마스터 파일 크기가 예상보다 큽니다");
  const zip = new AdmZip(bytes);
  const entry = zip.getEntries().find((item) => !item.isDirectory);
  if (!entry) throw new Error("종목 마스터 파일이 비어 있습니다");
  if (entry.header.size > 25_000_000)
    throw new Error("종목 마스터 압축 해제 크기가 예상보다 큽니다");
  return KOREAN_DECODER.decode(entry.getData());
}

function koreanMaster(text: string, market: "KOSPI" | "KOSDAQ") {
  const tailLength = market === "KOSPI" ? 228 : 222;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const head = line.slice(0, Math.max(0, line.length - tailLength));
      return {
        market: "KR" as const,
        symbol: head.slice(0, 9).trim(),
        name: head.slice(21).trim(),
        exchange: market,
      };
    })
    .filter((item) => /^[0-9A-Z]{6}$/.test(item.symbol) && item.name.length > 0);
}

function overseasMaster(text: string, exchange: "NAS" | "NYS" | "AMS") {
  return text
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .map((fields) => ({
      market: "US" as const,
      symbol: fields[4]?.trim().toUpperCase() ?? "",
      name: fields[6]?.trim() || fields[7]?.trim() || "",
      exchange,
    }))
    .filter(
      (item) => /^[A-Z.]{1,10}$/.test(item.symbol) && item.name.length > 0,
    );
}

async function instruments() {
  if (masterCache && masterCache.expiresAt > Date.now())
    return masterCache.instruments;
  const [kospi, kosdaq, nas, nys, ams] = await Promise.all([
    downloadMaster("kospi_code.mst"),
    downloadMaster("kosdaq_code.mst"),
    downloadMaster("nasmst.cod"),
    downloadMaster("nysmst.cod"),
    downloadMaster("amsmst.cod"),
  ]);
  const loaded = [
    ...koreanMaster(kospi, "KOSPI"),
    ...koreanMaster(kosdaq, "KOSDAQ"),
    ...overseasMaster(nas, "NAS"),
    ...overseasMaster(nys, "NYS"),
    ...overseasMaster(ams, "AMS"),
  ];
  masterCache = {
    instruments: loaded,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
  return loaded;
}

export async function findInstruments(market: Market, query: string) {
  const needle = normalize(query);
  if (!needle) return [];
  const catalog = (await instruments()).filter(
    (item) => item.market === market,
  );
  const exact = catalog.filter(
    (item) =>
      normalize(item.symbol) === needle || normalize(item.name) === needle,
  );
  if (exact.length) return exact.slice(0, 12);
  const matches = catalog
    .filter((item) => normalize(item.name).includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  return matches.slice(0, 12);
}

export async function quoteKis(
  market: Market,
  symbol: string,
  preferredExchange: string | null = null,
): Promise<KisQuote> {
  const base: KisQuote = {
    market,
    symbol,
    exchange: preferredExchange,
    price: null,
    currency: market === "KR" ? "KRW" : "USD",
    checkedAt: null,
    label: market === "KR" ? "한국투자증권 현재가" : "한국투자증권 해외 현재가",
  };
  try {
    if (market === "KR") {
      const output = await kisGet(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        "FHKST01010100",
        { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol },
      );
      const price = Number(output.stck_prpr);
      return Number.isFinite(price) && price > 0
        ? { ...base, price, checkedAt: new Date().toISOString() }
        : { ...base, error: "종목 코드 또는 시세를 확인할 수 없습니다" };
    }
    const exchanges =
      preferredExchange && ["NAS", "NYS", "AMS"].includes(preferredExchange)
        ? [preferredExchange]
        : ["NAS", "NYS", "AMS"];
    let lookupError: string | null = null;
    for (const exchange of exchanges) {
      try {
        const output = await kisGet(
          "/uapi/overseas-price/v1/quotations/price",
          "HHDFS00000300",
          { AUTH: "", EXCD: exchange, SYMB: symbol },
        );
        const price = Number(output.last);
        if (Number.isFinite(price) && price > 0) {
          return {
            ...base,
            exchange,
            price,
            checkedAt: new Date().toISOString(),
          };
        }
      } catch (error) {
        // A symbol may belong to another U.S. exchange. Continue probing it.
        lookupError = error instanceof Error ? error.message : "시세 조회 실패";
      }
    }
    return {
      ...base,
      error: lookupError ?? "티커 또는 거래소를 확인할 수 없습니다",
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : "시세 조회 실패",
    };
  }
}

export function kisConfigured() {
  return configured();
}
