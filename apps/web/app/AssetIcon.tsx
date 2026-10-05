import styles from "./AssetIcon.module.css";

type Props = {
  kind: "stock" | "crypto" | "cash";
  name: string;
  symbol?: string;
};

const stockLogos: Record<string, string> = {
  GOOGL: "google.svg",
  GOOG: "google.svg",
  QCOM: "qualcomm.svg",
  "005930": "samsung.svg",
  "005935": "samsung.svg",
  "005380": "hyundai.svg",
};

const cryptoLogos: Record<string, string> = {
  BTC: "btc.svg",
  ETH: "eth.svg",
  SOL: "sol.svg",
};

const palette = ["#256a76", "#41609a", "#6e5a9d", "#9b624b", "#597350"];

function badgeText(kind: Props["kind"], symbol: string, name: string) {
  if (kind === "cash") return symbol === "USD" ? "$" : "₩";
  if (/금현물|\bGOLD\b/i.test(name)) return "Au";
  if (/S&P\s*500|미국S&P500/i.test(name)) return "S&P";
  if (/나스닥|NASDAQ/i.test(name)) return "N100";
  if (/KODEX\s*200|KOSPI\s*200/i.test(name)) return "200";
  if (/AI반도체/i.test(name)) return "AI";
  if (symbol)
    return symbol.replace(/[^A-Z0-9]/g, "").slice(0, 3) || symbol.slice(0, 3);
  return name.replace(/\s/g, "").slice(0, 2);
}

export default function AssetIcon({ kind, name, symbol = "" }: Props) {
  const code = symbol.toUpperCase().replace(/^KRW-/, "");
  const logo =
    kind === "crypto"
      ? cryptoLogos[code]
      : kind === "stock"
        ? stockLogos[code]
        : undefined;
  const hash = [...(code || name)].reduce(
    (value, letter) => value + letter.charCodeAt(0),
    0,
  );
  const color =
    kind === "cash"
      ? "#a16a23"
      : /금현물|\bGOLD\b/i.test(name)
        ? "#987627"
        : palette[hash % palette.length];
  return (
    <span
      aria-hidden="true"
      className={`${styles.icon} ${logo ? styles.logo : styles.badge}`}
      style={logo ? undefined : { backgroundColor: color }}
    >
      {logo ? (
        // Bundled files keep the holdings list fast and avoid sending symbols to an image provider.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/asset-icons/${logo}`} alt="" loading="lazy" />
      ) : (
        <span>{badgeText(kind, code, name)}</span>
      )}
    </span>
  );
}
