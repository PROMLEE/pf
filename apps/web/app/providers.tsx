"use client";

import { SessionContext, type SessionContextValue } from "next-auth/react";
import type { Session } from "next-auth";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { requestSession, sessionAfterResult } from "../lib/client-session";
import styles from "./session.module.css";

/** Keep verified session UI through transient resume failures, never beyond its expiry.
 * NextAuth still handles OAuth, HttpOnly cookies and all server-side authorization.
 * Only browser session fetching is customized, because v4 collapses fetch errors into null.
 */
export default function Providers({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const sessionRef = useRef(session);
  const mounted = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef<Promise<Session | null> | null>(null);
  const lastAttempt = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCount = useRef(0);

  const refresh = useCallback((): Promise<Session | null> => {
    if (inFlight.current) return inFlight.current;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    const requestGeneration = generation.current;
    lastAttempt.current = Date.now();
    setChecking(true);
    const pending = requestSession()
      .then((result) => {
        if (!mounted.current || generation.current !== requestGeneration)
          return sessionRef.current ?? null;
        const next = sessionAfterResult(sessionRef.current, result);
        sessionRef.current = next;
        setSession(next);
        setUnavailable(result.kind === "unavailable");
        if (result.kind === "unavailable") {
          // Bounded backoff; online/pageshow/visibility events can restart recovery.
          if (retryCount.current < 4) {
            const delay = [1500, 3000, 6000, 12000][retryCount.current++];
            retryTimer.current = setTimeout(() => {
              if (document.visibilityState === "visible" && navigator.onLine)
                void refresh();
            }, delay);
          }
        } else retryCount.current = 0;
        return next ?? null;
      })
      .finally(() => {
        if (inFlight.current === pending) inFlight.current = null;
        if (mounted.current && generation.current === requestGeneration)
          setChecking(false);
      });
    inFlight.current = pending;
    return pending;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const resume = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (Date.now() - lastAttempt.current < 1000) return;
      if (
        sessionRef.current &&
        Date.parse(sessionRef.current.expires) <= Date.now()
      ) {
        sessionRef.current = null;
        setSession(null);
      }
      retryCount.current = 0;
      void refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "nextauth.message" || !event.newValue) return;
      try {
        const message = JSON.parse(event.newValue);
        if (message.event !== "session") return;
        if (message.data?.trigger === "signout") {
          // Another tab explicitly logged out: clear the old UI even while offline.
          generation.current++;
          sessionRef.current = null;
          setSession(null);
          setUnavailable(false);
          setChecking(false);
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = null;
        }
        void refresh();
      } catch {
        /* Ignore unrelated malformed storage events. */
      }
    };
    const poll = setInterval(resume, 5 * 60_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("storage", onStorage);
    return () => {
      mounted.current = false;
      generation.current++;
      inFlight.current = null;
      clearInterval(poll);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const expire = () => {
      if (
        !sessionRef.current ||
        Date.parse(sessionRef.current.expires) > Date.now()
      )
        return;
      sessionRef.current = null;
      setSession(null);
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = Date.parse(session.expires) - Date.now();
      timer = setTimeout(
        () => {
          if (remaining > 2_147_483_647) schedule();
          else expire();
        },
        Math.max(0, Math.min(remaining, 2_147_483_647)),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [session]);

  const context: SessionContextValue =
    session === undefined
      ? { data: null, status: "loading", update: refresh }
      : session === null
        ? { data: null, status: "unauthenticated", update: refresh }
        : { data: session, status: "authenticated", update: refresh };

  return (
    <SessionContext.Provider value={context}>
      <Fragment key={session?.user?.appUserId ?? "public"}>{children}</Fragment>
      {unavailable && (
        <aside className={styles.recovery} role="status">
          <span>
            {session
              ? "연결이 불안정해 로그인 상태를 다시 확인하고 있습니다."
              : "로그인 상태를 확인할 수 없습니다. 연결 후 다시 시도해 주세요."}
          </span>
          <button
            type="button"
            onClick={() => {
              retryCount.current = 0;
              void refresh();
            }}
            disabled={checking}
          >
            {checking ? "확인 중" : "다시 확인"}
          </button>
        </aside>
      )}
    </SessionContext.Provider>
  );
}
