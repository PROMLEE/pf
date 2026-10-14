"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./ServiceNotices.module.css";
type Notice = {
  id: string;
  title: string;
  body: string;
  important: boolean;
  created_at: string;
};
export default function ServiceNotices({
  onAdminChange,
}: {
  onAdminChange: (value: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let live = true;
    const target = new URL(window.location.href).searchParams.get("notice");
    setRequested(target);
    fetch(
      `/api/announcements${target ? `?notice=${encodeURIComponent(target)}` : ""}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("Notice unavailable");
        const data = await r.json();
        if (live) {
          setNotices(data.announcements);
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
  }, [onAdminChange]);
  useEffect(() => {
    if (requested && notices.length)
      detailsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  }, [requested, notices]);
  if (requested && loading)
    return <p role="status">공지를 불러오는 중입니다…</p>;
  if (requested && loadError)
    return (
      <p role="status">
        공지를 불러오지 못했습니다. 새로고침해서 다시 확인해 주세요.
      </p>
    );
  if (!notices.length)
    return requested ? (
      <p role="status">이 공지는 게시가 종료됐거나 현재 확인할 수 없습니다.</p>
    ) : null;
  return (
    <>
      {requested && !notices.some((n) => n.id === requested) && (
        <p role="status">
          요청한 공지는 게시가 종료됐거나 현재 확인할 수 없습니다. 아래에서 다른
          공지를 확인할 수 있습니다.
        </p>
      )}
      <details
        ref={detailsRef}
        className={styles.notices}
        open={requested ? true : undefined}
      >
        <summary>
          <span>{notices[0].important ? "중요 공지" : "공지"}</span>
          <strong>{notices[0].title}</strong>
          <small>전체 {notices.length}개</small>
        </summary>
        <div>
          {notices.map((n) => (
            <article key={n.id} id={`notice-${n.id}`}>
              <h3>
                {n.important && <span>중요 · </span>}
                {n.title}
              </h3>
              <small>
                {new Date(n.created_at).toLocaleDateString("ko-KR")}
              </small>
              <p>{n.body}</p>
            </article>
          ))}
        </div>
      </details>
    </>
  );
}
