import { getMarketCapRank } from "@/lib/market/draft-pool";

/** Lottery-tier = outside S&P Top 100 by market cap rank (or unranked). */
export function isLotteryTierSymbol(symbol: string): boolean {
  const rank = getMarketCapRank({ symbol: symbol.toUpperCase() });
  return rank == null || rank > 100;
}
