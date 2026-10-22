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
  const [status, setStatus] = useState<MeritzSyncStatus>({ available: false }),
    [checking, setChecking] = useState(false);
  const latest = useRef({ paused, onApplied });
  latest.current = { paused, onApplied };
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    setStatus({ available: false });
    if (!authenticated || !userId) return;
    let active = true,
      initialized = false,
      inFlight = false,
      current: MeritzSyncStatus = { available: false };
    const tick = async (reload = false) => {
      if (!active || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        if (reload || !initialized || (current.available && !current.enabled)) {
          const r = await fetch("/api/accounts/meritz/sync", {
            cache: "no-store",
          });
          if (!r.ok) throw Error();
          current = await r.json();
          initialized = true;
          if (active) {
            setStatus(current);
            window.dispatchEvent(
              new CustomEvent(meritzSyncStatusEvent, { detail: current }),
            );
          }
        }
        if (!current.available || !current.enabled || latest.current.paused)
          return;
        if (active) setChecking(true);
        const r = await fetch("/api/accounts/meritz/sync", { method: "POST" });
        if (!r.ok) throw Error();
        const result = await r.json();
        if (result.sync) {
          current = result.sync;
          if (active) {
            setStatus(current);
            window.dispatchEvent(
              new CustomEvent(meritzSyncStatusEvent, { detail: current }),
            );
          }
        }
        if (
          active &&
          !latest.current.paused &&
          result.holdings &&
          result.portfolio
        )
          latest.current.onApplied(result);
      } catch {
        if (active)
          setStatus((s) =>
            s.available
              ? {
                  ...s,
                  error:
                    "동기화 연결을 확인하지 못했습니다. 기존 잔고를 표시합니다.",
                }
              : s,
          );
      } finally {
        inFlight = false;
        if (active) setChecking(false);
      }
    };
    const visible = () => void tick();
    wake.current = visible;
    const settings = () => void tick(true);
    void tick(true);
    const timer = window.setInterval(visible, 30000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener(meritzSyncSettingsEvent, settings);
    return () => {
      active = false;
      wake.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener(meritzSyncSettingsEvent, settings);
    };
  }, [userId, authenticated]);
  useEffect(() => {
    if (!paused) wake.current();
  }, [paused]);
  return { status, checking };
}
