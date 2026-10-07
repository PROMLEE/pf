import type { Session } from "next-auth";

export type SessionResult =
  | { kind: "confirmed"; session: Session | null }
  | { kind: "unavailable" };

/** Only an authenticated endpoint response can confirm logout; transport errors cannot. */
export async function requestSession(
  fetcher: typeof fetch = fetch,
): Promise<SessionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) return { kind: "confirmed", session: null };
    if (!response.ok) return { kind: "unavailable" };
    const value: unknown = await response.json();
    if (
      value === null ||
      (typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0)
    )
      return { kind: "confirmed", session: null };
    if (
      typeof value !== "object" ||
      !value ||
      !("expires" in value) ||
      typeof value.expires !== "string" ||
      !Number.isFinite(Date.parse(value.expires)) ||
      !("user" in value) ||
      typeof value.user !== "object" ||
      !value.user
    )
      return { kind: "unavailable" };
    return { kind: "confirmed", session: value as Session };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export function sessionAfterResult(
  previous: Session | null | undefined,
  result: SessionResult,
  now = Date.now(),
): Session | null | undefined {
  const next = result.kind === "confirmed" ? result.session : previous;
  if (next && Date.parse(next.expires) <= now) return null;
  return next;
}
