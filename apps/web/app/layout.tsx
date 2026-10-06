import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Portfolio | 나만의 자산 전략",
  description:
    "목표 비중을 설계하고 국내외 자산을 연결해 포트폴리오를 관리하세요.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <Script id="initial-theme" strategy="beforeInteractive">
          {`try { document.documentElement.dataset.theme = localStorage.getItem("pf-theme") === "dark" ? "dark" : "light"; } catch { document.documentElement.dataset.theme = "light"; }`}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
