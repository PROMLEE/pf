"use client";
import { useEffect, useState } from "react";
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
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/announcements", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        if (live) {
          setNotices(data.announcements);
          onAdminChange(data.isAdmin === true);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [onAdminChange]);
  if (!notices.length) return null;
  return (
    <details className={styles.notices}>
      <summary>
        <span>{notices[0].important ? "중요 공지" : "공지"}</span>
        <strong>{notices[0].title}</strong>
        <small>전체 {notices.length}개</small>
      </summary>
      <div>
        {notices.map((n) => (
          <article key={n.id}>
            <h3>
              {n.important && <span>중요 · </span>}
              {n.title}
            </h3>
            <small>{new Date(n.created_at).toLocaleDateString("ko-KR")}</small>
            <p>{n.body}</p>
          </article>
        ))}
      </div>
    </details>
  );
}
