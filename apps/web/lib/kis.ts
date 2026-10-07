import AdmZip from "adm-zip";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Market } from "../app/holdings";
import { db } from "./db";
import { domesticPreviousClose } from "./kis-quote-values";

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
  previousClose: number | null;
  currency: "KRW" | "USD";
  checkedAt: string | null;
  label: string;
  error?: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;
const masterCache = new Map<
  Market,
  { instruments: Instrument[]; expiresAt: number }
>();
const pendingMasters = new Map<Market, Promise<Instrument[]>>();
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

function tokenCacheKey() {
  return createHash("sha256")
    .update(
      `kis-token-cache\0${BASE}\0${process.env.KIS_APP_KEY}\0${process.env.KIS_APP_SECRET}`,
    )
    .digest("hex");
}

function tokenEncryptionKey() {
  return createHash("sha256")
    .update(
      `kis-token-encryption\0${process.env.KIS_APP_KEY}\0${process.env.KIS_APP_SECRET}`,
    )
    .digest();
}

function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decryptToken(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 29) throw new Error("Invalid cached token");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenEncryptionKey(),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

async function issueToken() {
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
    expires_in?: number | string;
    access_token_token_expired?: string;
    msg1?: string;
  };
  if (!response.ok || !payload.access_token)
    throw new Error(
      payload.msg1 || `한국투자증권 토큰 발급 실패 (${response.status})`,
    );
  const now = Date.now();
  const duration = Number(payload.expires_in);
  const absolute = payload.access_token_token_expired
    ? Date.parse(
        `${payload.access_token_token_expired.replace(" ", "T")}+09:00`,
      )
    : NaN;
  const expiry = Math.min(
    Number.isFinite(duration) && duration > 0
      ? now + duration * 1000
      : Infinity,
    Number.isFinite(absolute) ? absolute : Infinity,
  );
  return {
    value: payload.access_token,
    expiresAt: Math.max(
      now + 1000,
      (Number.isFinite(expiry) ? expiry : now + 24 * 60 * 60 * 1000) -
        5 * 60 * 1000,
    ),
  };
}

async function loadOrIssueToken() {
  const key = tokenCacheKey();
  const client = await db().connect();
  try {
    await client.query("begin");
    // Serialize token refresh across serverless instances using the same app key.
    await client.query(
      "select pg_advisory_xact_lock(1779452331, hashtext($1))",
      [key],
    );
    const existing = await client.query<{
      token_ciphertext: string;
      expires_at: Date;
    }>(
      `select token_ciphertext, expires_at from portfolio.kis_token_cache where cache_key = $1`,
      [key],
    );
    const row = existing.rows[0];
    if (row && row.expires_at.getTime() > Date.now()) {
      try {
        const value = decryptToken(row.token_ciphertext);
        cachedToken = { value, expiresAt: row.expires_at.getTime() };
        await client.query("commit");
        return value;
      } catch {
        // An unreadable entry is replaced by a newly issued token below.
      }
    }
    const issued = await issueToken();
    await client.query(
      `insert into portfolio.kis_token_cache (cache_key, token_ciphertext, expires_at)
       values ($1, $2, $3)
       on conflict (cache_key) do update set token_ciphertext = excluded.token_ciphertext,
         expires_at = excluded.expires_at, updated_at = now()`,
      [key, encryptToken(issued.value), new Date(issued.expiresAt)],
    );
    await client.query("commit");
    cachedToken = issued;
    return issued.value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function token() {
  requireConfiguration();
  if (cachedToken && cachedToken.expiresAt > Date.now())
    return cachedToken.value;
  if (!pendingToken) {
    pendingToken = loadOrIssueToken().finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
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
      payload.msg_cd === "EGW00201" || payload.msg1?.includes("초당 거래건수");
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
    .filter(
      (item) => /^[0-9A-Z]{6}$/.test(item.symbol) && item.name.length > 0,
    );
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

async function instruments(market: Market) {
  const cached = masterCache.get(market);
  if (cached && cached.expiresAt > Date.now()) return cached.instruments;
  const pending = pendingMasters.get(market);
  if (pending) return pending;
  const loading = (async () => {
    let loaded: Instrument[];
    if (market === "KR") {
      const [kospi, kosdaq] = await Promise.all([
        downloadMaster("kospi_code.mst"),
        downloadMaster("kosdaq_code.mst"),
      ]);
      loaded = [
        ...koreanMaster(kospi, "KOSPI"),
        ...koreanMaster(kosdaq, "KOSDAQ"),
      ];
    } else {
      const [nas, nys, ams] = await Promise.all([
        downloadMaster("nasmst.cod"),
        downloadMaster("nysmst.cod"),
        downloadMaster("amsmst.cod"),
      ]);
      loaded = [
        ...overseasMaster(nas, "NAS"),
        ...overseasMaster(nys, "NYS"),
        ...overseasMaster(ams, "AMS"),
      ];
    }
    masterCache.set(market, {
      instruments: loaded,
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    });
    return loaded;
  })();
  pendingMasters.set(market, loading);
  try {
    return await loading;
  } finally {
    pendingMasters.delete(market);
  }
}

export async function findInstruments(market: Market, query: string) {
  const needle = normalize(query);
  if (!needle) return [];
  const catalog = await instruments(market);
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
    previousClose: null,
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
      // inquire-price returns the change from the previous close, not
      // stck_prdy_clpr (which belongs to a different KIS endpoint).
      const previousClose = domesticPreviousClose(output);
      return Number.isFinite(price) && price > 0
        ? {
            ...base,
            price,
            previousClose,
            checkedAt: new Date().toISOString(),
          }
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
        const previousClose = Number(output.base);
        if (Number.isFinite(price) && price > 0) {
          return {
            ...base,
            exchange,
            price,
            previousClose:
              Number.isFinite(previousClose) && previousClose > 0
                ? previousClose
                : null,
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
