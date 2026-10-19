import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicNotice } from "../../../lib/public-notices";
import styles from "../notices.module.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const notice = await getPublicNotice((await params).id);
  if (!notice)
    return {
      title: "공지를 찾을 수 없습니다 | PortRhythm",
      robots: { index: false, follow: true },
    };
  const title = `${notice.title} | PortRhythm 공지사항`;
  const description = notice.body.replace(/\s+/g, " ").trim().slice(0, 160);
  const url = `https://pf.promleeblog.com/notices/${notice.id}`;
  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "article",
      locale: "ko_KR",
      siteName: "PortRhythm",
      publishedTime: notice.created_at.toISOString(),
      modifiedTime: notice.updated_at.toISOString(),
    },
  };
}

export default async function NoticePage({ params }: Props) {
  const notice = await getPublicNotice((await params).id);
  if (!notice) notFound();
  return (
    <main className={styles.page}>
      <nav className={styles.nav} aria-label="공지 메뉴">
        <Link href="/notices">← 공지사항</Link>
        <Link href="/">내 포트폴리오</Link>
      </nav>
      <article>
        <header className={styles.heading}>
          {notice.important && <span className={styles.badge}>중요 공지</span>}
          <h1>{notice.title}</h1>
          <time dateTime={notice.created_at.toISOString()}>
            {notice.created_at.toLocaleDateString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </time>
        </header>
        <div className={styles.body}>{notice.body}</div>
      </article>
      <footer className={styles.footer}>
        <Link href="/notices">전체 공지 보기</Link>
        <Link href="/guide">사용 가이드</Link>
      </footer>
    </main>
  );
}
