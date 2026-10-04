const seedPrices = {
  "AAPL": 208.12,
  "TSLA": 182.55,
  "QQQ": 509.42,
  "SPY": 602.31,
  "BTC": 103250.0,
  "GLD": 228.2,
  "069500.KS": 35500,
  "381170.KS": 21790
};

export async function getQuotes(symbols: string[]) {
  const now = new Date().toISOString();
  return symbols.map((symbol) => ({
    symbol,
    price: seedPrices[symbol] ?? 0,
    currency: symbol.endsWith(".KS") ? "KRW" : symbol === "BTC" ? "USD" : "USD",
    asOf: now,
    provider: "mock-feed"
  }));
}
