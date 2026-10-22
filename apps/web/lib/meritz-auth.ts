import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { db } from "./db";
export const meritzBase = () => "https://openapi.imeritz.com:9443";
export const meritzConfigured = () =>
  Boolean(process.env.MERITZ_APP_KEY && process.env.MERITZ_APP_SECRET);
const identity = () =>
  `${meritzBase()}\0${process.env.MERITZ_APP_KEY}\0${process.env.MERITZ_APP_SECRET}`;
const cacheKey = () =>
  createHash("sha256").update(`meritz-token\0${identity()}`).digest("hex");
const encryptionKey = () =>
  createHash("sha256")
    .update(`meritz-token-encryption\0${identity()}`)
    .digest();
function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return Buffer.concat([
    iv,
    cipher.update(value),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString("base64");
}
function decrypt(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 29) throw Error("Invalid cache");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    bytes.subarray(0, 12),
  );
  cipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([
    cipher.update(bytes.subarray(12, -16)),
    cipher.final(),
  ]).toString("utf8");
}
let cached: { key: string; value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;
async function load(rejected?: string) {
  const key = cacheKey(),
    client = await db().connect();
  try {
    await client.query("begin");
    await client.query(
      "select pg_advisory_xact_lock(1779452332,hashtext($1))",
      [key],
    );
    const row = (
      await client.query<{ token_ciphertext: string; expires_at: Date }>(
        "select token_ciphertext,expires_at from portfolio.market_data_tokens where cache_key=$1",
        [key],
      )
    ).rows[0];
    if (row && row.expires_at.getTime() > Date.now()) {
      let value: string | null = null;
      try {
        value = decrypt(row.token_ciphertext);
      } catch {
        /* Replace unreadable encrypted entries under the same lock. */
      }
      if (value && value !== rejected) {
        await client.query("commit");
        cached = { key, value, expiresAt: row.expires_at.getTime() };
        return value;
      }
    }
    const response = await fetch(`${meritzBase()}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "login",
        client_id: process.env.MERITZ_APP_KEY!,
        client_secret: process.env.MERITZ_APP_SECRET!,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw Error(
        response.status === 403
          ? "메리츠증권 API 접근 권한을 확인해 주세요."
          : response.status === 401
            ? "메리츠증권 API 인증 설정을 확인해 주세요."
            : `메리츠증권 인증 요청 실패 (${response.status})`,
      );
    const payload = await response.json();
    const duration = Number(payload.expires_in);
    if (
      typeof payload.access_token !== "string" ||
      !payload.access_token ||
      !Number.isFinite(duration) ||
      duration <= 10
    )
      throw Error("메리츠증권 토큰 응답을 확인할 수 없습니다.");
    const expiresAt =
      Date.now() + (duration - Math.min(300, duration / 10)) * 1000;
    await client.query(
      "insert into portfolio.market_data_tokens(cache_key,token_ciphertext,expires_at) values($1,$2,$3) on conflict(cache_key) do update set token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at,updated_at=now()",
      [key, encrypt(payload.access_token), new Date(expiresAt)],
    );
    await client.query("commit");
    cached = { key, value: payload.access_token, expiresAt };
    return payload.access_token as string;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export async function meritzToken(rejected?: string): Promise<string> {
  if (!meritzConfigured()) throw Error("메리츠증권 API가 설정되지 않았습니다.");
  if (
    cached?.key === cacheKey() &&
    cached.expiresAt > Date.now() &&
    cached.value !== rejected
  )
    return cached.value;
  if (pending) {
    const value = await pending;
    if (value !== rejected) return value;
  }
  const request = load(rejected);
  pending = request;
  try {
    return await request;
  } finally {
    if (pending === request) pending = null;
  }
}
