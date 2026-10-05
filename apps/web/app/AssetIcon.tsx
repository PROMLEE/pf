"use client";

import { useEffect, useState } from "react";
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
    return candidates;
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
  const { kind, name, symbol = "" } = props;
  const urls = imageUrls(props);
  const identity = `${kind}:${props.market ?? ""}:${props.exchange ?? ""}:${symbol}:${name}`;
  const [image, setImage] = useState({ identity, index: 0, loaded: false });

  useEffect(() => {
    setImage({ identity, index: 0, loaded: false });
  }, [identity]);

  const index = image.identity === identity ? image.index : 0;
  const loaded = image.identity === identity && image.loaded;
  const url = urls[index];
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
          key={url}
          src={url}
          alt=""
          loading="lazy"
          className={loaded ? styles.visibleImage : styles.pendingImage}
          onLoad={() => setImage({ identity, index, loaded: true })}
          onError={() =>
            setImage({ identity, index: index + 1, loaded: false })
          }
        />
      )}
    </span>
  );
}
