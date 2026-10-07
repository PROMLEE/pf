import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "PortRhythm | 투자는 리듬을 타듯",
  description:
    "투자는 리듬을 타듯. 나만의 목표 비중을 설계하고 자산을 점검하며 리밸런싱하세요.",
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
