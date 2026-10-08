import type { Metadata } from "next";
import Link from "next/link";
import UserGuide from "../UserGuide";
import styles from "../UserGuide.module.css";

export const metadata: Metadata = {
  title: "사용 가이드 | PortRhythm",
  description:
    "목표 비중 설계부터 자산 등록·수정·배정과 리밸런싱까지, PortRhythm 시작 안내.",
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
