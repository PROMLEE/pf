import type { Metadata } from "next";
import Link from "next/link";
import UserGuide from "../UserGuide";
import styles from "../UserGuide.module.css";

const searchTitle = "포트폴리오 관리·리밸런싱 사용 가이드 | 포트리듬";
const searchDescription = "포트리듬에서 주식·ETF·가상자산 포트폴리오를 관리하는 방법을 알아보세요. 목표 비중 설정, 증권 계좌 등록, 자산 수정·배정, 환율 손익, 리밸런싱 수량 확인과 자산 기록을 단계별로 안내합니다.";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
  title: searchTitle,
  description: searchDescription,
  alternates: { canonical: "https://pf.promleeblog.com/guide" },
  openGraph: {
    title: searchTitle,
    description: searchDescription,
    url: "https://pf.promleeblog.com/guide",
    siteName: "PortRhythm · 포트리듬",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/guide/desktop-composition.jpg", width: 1280, height: 720, alt: "포트리듬 포트폴리오 관리 사용 가이드" }],
  },
  twitter: {
    card: "summary_large_image",
    title: searchTitle,
    description: searchDescription,
    images: ["/guide/desktop-composition.jpg"],
  },
};

export default function GuidePage() {
  return (
    <main className={styles.public}>
      <nav className={styles.publicNav} aria-label="서비스 안내">
        <Link href="/">PR · PortRhythm</Link>
        <Link href="/about">서비스 소개 →</Link>
      </nav>
      <UserGuide />
    </main>
  );
}
