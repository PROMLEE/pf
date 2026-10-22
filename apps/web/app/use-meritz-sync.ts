"use client";
import { useEffect, useRef, useState } from "react";
import type { Holding } from "./holdings";
import type { Portfolio } from "./portfolio-model";
export type MeritzSyncStatus = {
  available: boolean;
  configured?: boolean;
  enabled?: boolean;
  accountId?: string | null;
  accountName?: string | null;
  lastSuccessAt?: string | null;
  lastAttemptAt?: string | null;
  error?: string | null;
  count?: number;
};
export const meritzSyncSettingsEvent = "pf-meritz-sync-settings";
export const meritzSyncStatusEvent = "pf-meritz-sync-status";
export const meritzSyncRequestEvent = "pf-meritz-sync-request";
export function useMeritzSync({
  userId,
  authenticated,
  paused,
  onApplied,
}: {
  userId: string;
  authenticated: boolean;
  paused: boolean;
  onApplied: (result: { holdings: Holding[]; portfolio: Portfolio }) => void;
}) {
  const [status, setStatus] = useState<MeritzSyncStatus>({ available: false });
  const [checking, setChecking] = useState(false);
  const latest = useRef({ paused, onApplied });
  latest.current = { paused, onApplied };
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    setStatus({ available: false });
    setChecking(false);
    if (!authenticated || !userId) return;
    let active = true,
      initialized = false,
      inFlight = false,
      pending = true;
    let current: MeritzSyncStatus = { available: false };
    const publish = (next: MeritzSyncStatus) => {
      current = next;
      if (!active) return;
      setStatus(next);
      window.dispatchEvent(
        new CustomEvent(meritzSyncStatusEvent, { detail: next }),
      );
    };
    const tick = async () => {
      if (!active || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        if (!initialized) {
          const r = await fetch("/api/accounts/meritz/sync", {
            cache: "no-store",
          });
          if (!r.ok) throw Error();
          const next = await r.json();
          if (!active) return;
          initialized = true;
          publish(next);
        }
        if (
          !active ||
          !pending ||
          !current.available ||
          !current.enabled ||
          latest.current.paused
        )
          return;
        pending = false;
        setChecking(true);
        const r = await fetch("/api/accounts/meritz/sync", { method: "POST" });
        const result = await r.json();
        if (!active) return;
        if (!r.ok)
          throw Error(
            result.message || "동기화하지 못했습니다. 다시 시도해 주세요.",
          );
        if (result.sync) publish(result.sync);
        if (result.holdings && result.portfolio) {
          if (latest.current.paused) pending = true;
          else latest.current.onApplied(result);
        }
      } catch (e) {
        pending = false;
        if (active && current.available)
          publish({
            ...current,
            error:
              e instanceof Error && e.message
                ? e.message
                : "동기화 연결을 확인하지 못했습니다. 다시 시도해 주세요.",
          });
      } finally {
        inFlight = false;
        if (active) setChecking(false);
      }
    };
    const resume = () => {
      if (pending) void tick();
    };
    const request = () => {
      if (inFlight || latest.current.paused) return;
      pending = true;
      void tick();
    };
    const settings = () => {
      initialized = false;
      pending = true;
      void tick();
    };
    wake.current = resume;
    void tick();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener(meritzSyncSettingsEvent, settings);
    window.addEventListener(meritzSyncRequestEvent, request);
    return () => {
      active = false;
      wake.current = () => {};
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener(meritzSyncSettingsEvent, settings);
      window.removeEventListener(meritzSyncRequestEvent, request);
    };
  }, [userId, authenticated]);
  useEffect(() => {
    if (!paused) wake.current();
  }, [paused]);
  return {
    status,
    checking,
    canSync: !paused && !checking && !!status.enabled,
    synchronize: () => window.dispatchEvent(new Event(meritzSyncRequestEvent)),
  };
}
