import type { Portfolio } from "./portfolio-model";

export const portfolioCache = new Map<string, Portfolio | null>();
export const tradePortfolioEvent = "pf-trade-portfolio-updated";
export function publishTradePortfolio(
  portfolio: Portfolio,
  cashAssetId: string,
) {
  portfolioCache.clear();
  window.dispatchEvent(
    new CustomEvent(tradePortfolioEvent, {
      detail: { portfolio, cashAssetId },
    }),
  );
}
