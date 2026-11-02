"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  SlidersHorizontal,
} from "lucide-react";
import styles from "./PreferencesTabs.module.css";

const tabs = [
  { id: "notifications", label: "알림", Icon: Bell },
  { id: "review", label: "점검 일정", Icon: CalendarDays },
  { id: "valuation", label: "환율·손익", Icon: ChartNoAxesCombined },
  { id: "general", label: "기본 설정", Icon: SlidersHorizontal },
] as const;
export type PreferenceTab = (typeof tabs)[number]["id"];
const storageKey = "pf.settings.tab.v1";

export default function PreferencesTabs({
  initialTab,
  panels,
  reviewDirty,
  onTabChange,
}: {
  initialTab?: PreferenceTab;
  panels: Record<PreferenceTab, ReactNode>;
  reviewDirty: boolean;
  onTabChange: (tab: PreferenceTab) => void;
}) {
  const [active, setActive] = useState<PreferenceTab>(
    initialTab ?? "notifications",
  );
  const [visited, setVisited] = useState<PreferenceTab[]>([
    initialTab ?? "notifications",
  ]);
  const nav = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    try {
      if (initialTab) {
        localStorage.setItem(storageKey, initialTab);
        return;
      }
      const saved = localStorage.getItem(storageKey);
      if (tabs.some((tab) => tab.id === saved)) {
        setActive(saved as PreferenceTab);
        setVisited((current) => [
          ...new Set([...current, saved as PreferenceTab]),
        ]);
      }
    } catch {}
  }, [initialTab]);

  function select(tab: PreferenceTab) {
    setActive(tab);
    onTabChange(tab);
    setVisited((current) =>
      current.includes(tab) ? current : [...current, tab],
    );
    try {
      localStorage.setItem(storageKey, tab);
    } catch {}
  }

  return (
    <div className={styles.settings}>
      <div
        ref={nav}
        className={styles.tabs}
        role="tablist"
        aria-label="설정 분류"
      >
        {tabs.map(({ id: tab, label, Icon }, index) => (
          <button
            key={tab}
            id={`${id}-${tab}-tab`}
            type="button"
            role="tab"
            aria-selected={active === tab}
            aria-controls={`${id}-${tab}-panel`}
            tabIndex={active === tab ? 0 : -1}
            onClick={() => select(tab)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              select(tabs[next].id);
              nav.current
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
            {tab === "review" && reviewDirty && (
              <i
                className={styles.unsaved}
                aria-label="저장하지 않은 변경 있음"
              />
            )}
          </button>
        ))}
      </div>
      {tabs.map(({ id: tab }) => (
        <div
          key={tab}
          id={`${id}-${tab}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}-tab`}
          hidden={active !== tab}
          className={styles.panel}
          tabIndex={0}
        >
          {/* Keep visited panels mounted so changing tabs never discards drafts. */}
          {visited.includes(tab) || active === tab ? panels[tab] : null}
        </div>
      ))}
    </div>
  );
}
