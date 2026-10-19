import type { Metadata } from "next";
import Link from "next/link";
import { listPublicNotices } from "../../lib/public-notices";
import styles from "./notices.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "공지사항 · 업데이트 소식 | PortRhythm",
  description:
    "PortRhythm의 포트폴리오 관리와 리밸런싱 기능 업데이트, 서비스 소식을 확인하세요.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://pf.promleeblog.com/notices" },
};

export default async function NoticesPage() {
  const notices = await listPublicNotices();
  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="서비스 메뉴">
        <Link href="/about" className={styles.brand}>
          PortRhythm
        </Link>
        <Link href="/">내 포트폴리오</Link>
      </nav>
      <header className={styles.heading}>
        <h1>공지사항</h1>
        <p>업데이트와 서비스 소식을 전합니다.</p>
      </header>
      {!notices.length ? (
        <p>아직 게시된 공지가 없습니다.</p>
      ) : (
        <ul className={styles.list}>
          {notices.map((notice) => (
            <li key={notice.id}>
              <Link href={`/notices/${notice.id}`} prefetch={false}>
                <span>
                  {notice.important && (
                    <span className={styles.badge}>중요</span>
                  )}
                  <strong>{notice.title}</strong>
                </span>
                <time dateTime={notice.created_at.toISOString()}>
                  {notice.created_at.toLocaleDateString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <footer className={styles.footer}>
        <Link href="/guide">사용 가이드</Link>
        <Link href="/about">서비스 소개</Link>
      </footer>
    </main>
  );
}
