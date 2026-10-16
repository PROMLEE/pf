"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import styles from "./ServiceNotices.module.css";
type Notice = {
  id: string;
  title: string;
  body: string;
  important: boolean;
  created_at: string;
};
const date = (value: string) => new Date(value).toLocaleDateString("ko-KR");
export default function ServiceNotices({
  userId,
  page,
  selectedId,
  onOpen,
  onAdminChange,
}: {
  userId: string;
  page: boolean;
  selectedId: string | null;
  onOpen: (id: string | null) => void;
  onAdminChange: (value: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const storageKey = `pf-notice-dismissed:${userId}`;
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey));
    } catch {
      setDismissed(null);
    }
  }, [storageKey]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError(false);
    const target = new URL(window.location.href).searchParams.get("notice");
    fetch(
      `/api/announcements${target ? `?notice=${encodeURIComponent(target)}` : ""}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("Notice unavailable");
        const data = await r.json();
        if (live) {
          setNotices(
            [...data.announcements].sort(
              (a: Notice, b: Notice) =>
                Date.parse(b.created_at) - Date.parse(a.created_at) ||
                b.id.localeCompare(a.id),
            ),
          );
          onAdminChange(data.isAdmin === true);
        }
      })
      .catch(() => {
        if (live) setLoadError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [userId, onAdminChange, attempt]);
  const latest = notices[0];
  const selected = notices.find((n) => n.id === selectedId);
  if (!page) {
    if (loading || loadError || !latest || dismissed === latest.id) return null;
    return (
      <aside className={styles.banner} aria-label="최신 공지">
        <button
          type="button"
          className={styles.bannerLink}
          onClick={() => onOpen(latest.id)}
        >
          <span>공지</span>
          <strong>{latest.title}</strong>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.dismiss}
          aria-label="상단 공지 닫기"
          onClick={() => {
            setDismissed(latest.id);
            try {
              localStorage.setItem(storageKey, latest.id);
            } catch {
              /* Hide for this visit. */
            }
          }}
        >
          <X size={17} />
        </button>
      </aside>
    );
  }
  return (
    <section className={styles.page} aria-label="공지사항">
      <header>
        <h1>공지사항</h1>
        <p>업데이트와 서비스 소식을 확인하세요.</p>
      </header>
      {loading ? (
        <p role="status">공지를 불러오는 중입니다…</p>
      ) : loadError ? (
        <div role="alert">
          <p>공지를 불러오지 못했습니다.</p>
          <button
            type="button"
            className={styles.back}
            onClick={() => setAttempt((v) => v + 1)}
          >
            다시 불러오기
          </button>
        </div>
      ) : selectedId ? (
        <>
          <button
            type="button"
            className={styles.back}
            onClick={() => onOpen(null)}
          >
            <ArrowLeft size={16} />
            공지 목록
          </button>
          {selected ? (
            <article className={styles.article}>
              {selected.important && (
                <span className={styles.important}>중요 공지</span>
              )}
              <h2>{selected.title}</h2>
              <time dateTime={selected.created_at}>
                {date(selected.created_at)}
              </time>
              <p>{selected.body}</p>
            </article>
          ) : (
            <p role="status">
              이 공지는 게시가 종료됐거나 현재 확인할 수 없습니다.
            </p>
          )}
        </>
      ) : (
        <div className={styles.list}>
          {!notices.length && <p>아직 게시된 공지가 없습니다.</p>}
          {notices.map((n) => (
            <button
              type="button"
              key={n.id}
              className={styles.row}
              onClick={() => onOpen(n.id)}
            >
              <span>
                {n.important && (
                  <small className={styles.important}>중요</small>
                )}
                <strong>{n.title}</strong>
                <time dateTime={n.created_at}>{date(n.created_at)}</time>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
