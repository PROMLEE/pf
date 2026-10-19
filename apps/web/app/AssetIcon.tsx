"use client";

import { useCallback, useEffect, useState } from "react";
import type { Market } from "./holdings";
import styles from "./AssetIcon.module.css";

type Props = {
  kind: "stock" | "crypto" | "cash";
  name: string;
  symbol?: string;
  market?: Market;
  exchange?: string | null;
};

const imageBase = "https://images.financialmodelingprep.com/symbol/";

function imageUrls({ kind, name, symbol = "", market, exchange }: Props) {
  const code = symbol.toUpperCase().replace(/^KRW-/, "").trim();
  if (!/^[A-Z0-9.\-]+$/.test(code)) return [];
  if (kind === "crypto")
    return [`${imageBase}${encodeURIComponent(code)}USD.png`];
  if (kind !== "stock") return [];

  if (market === "KR") {
    const preferred = /KOSDAQ|\.KQ$/i.test(exchange ?? "") ? "KQ" : "KS";
    const other = preferred === "KS" ? "KQ" : "KS";
    const stem = code.replace(/\.(KS|KQ)$/, "");
    const candidates = [
      `${imageBase}${encodeURIComponent(`${stem}.${preferred}`)}.png`,
    ];
    // Domestic ETFs without an individual image can use their issuer's mark.
    if (/^KODEX\b/i.test(name)) candidates.push(`${imageBase}069500.KS.png`);
    if (/^ACE\b/i.test(name))
      candidates.push("https://www.aceetf.co.kr/favicon.ico");
    candidates.push(
      `${imageBase}${encodeURIComponent(`${stem}.${other}`)}.png`,
    );
    return [...new Set(candidates)];
  }
  return [`${imageBase}${encodeURIComponent(code)}.png`];
}

function fallbackText(kind: Props["kind"], symbol: string, name: string) {
  if (kind === "cash") return symbol === "USD" ? "$" : "₩";
  if (/^KODEX\b/i.test(name)) return "KODEX";
  if (/^ACE\b/i.test(name)) return "ACE";
  if (/^SOL\b/i.test(name)) return "SOL";
  if (/^TIGER\b/i.test(name)) return "TIGER";
  if (symbol) return symbol.replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return name.replace(/\s/g, "").slice(0, 2);
}

export default function AssetIcon(props: Props) {
  const urls = imageUrls(props);
  // Names can change after symbol lookup without changing the actual image.
  // Reset only when the resource list changes, never after a completed load.
  return (
    <AssetImage
      key={`${props.kind}:${JSON.stringify(urls)}`}
      {...props}
      urls={urls}
    />
  );
}

function AssetImage({
  kind,
  name,
  symbol = "",
  urls,
}: Props & { urls: string[] }) {
  const [image, setImage] = useState({ index: 0, loaded: false, attempt: 0 });
  const { index, loaded, attempt } = image;
  const url = urls[index];
  const markLoaded = useCallback(() => {
    setImage((current) =>
      current.index === index && current.attempt === attempt && !current.loaded
        ? { ...current, loaded: true }
        : current,
    );
  }, [index, attempt]);
  const imageRef = useCallback(
    (node: HTMLImageElement | null) => {
      // A warm-cache image may already be complete before React receives load.
      if (node?.complete && node.naturalWidth > 0) markLoaded();
    },
    [markLoaded],
  );
  useEffect(() => {
    if (url || !urls.length || attempt > 0) return;
    const timer = window.setTimeout(() => {
      setImage((current) =>
        current.index === index && current.attempt === attempt
          ? { index: 0, loaded: false, attempt: 1 }
          : current,
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [url, urls.length, index, attempt]);
  return (
    <span
      aria-hidden="true"
      className={`${styles.icon} ${loaded ? styles.logo : styles.badge} ${kind === "cash" ? styles.cash : ""}`}
    >
      {!loaded && (
        <span className={styles.fallback}>
          {fallbackText(kind, symbol.toUpperCase().replace(/^KRW-/, ""), name)}
        </span>
      )}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${url}:${attempt}`}
          ref={imageRef}
          src={url}
          alt=""
          loading="lazy"
          className={loaded ? styles.visibleImage : styles.pendingImage}
          onLoad={markLoaded}
          onError={() =>
            setImage((current) =>
              current.index === index && current.attempt === attempt
                ? { ...current, index: index + 1, loaded: false }
                : current,
            )
          }
        />
      )}
    </span>
  );
}
