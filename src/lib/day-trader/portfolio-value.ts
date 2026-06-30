import { fetchCachedStockQuotes } from "@/lib/market/cached-prices";

export function computeDayTraderEntryValue(
  cashBalance: number,
  positions: readonly { symbol: string; shares: number }[],
  quotes: Record<string, { price: number }>
): number {
  let equity = 0;
  for (const position of positions) {
    const quote = quotes[position.symbol.toUpperCase()];
    equity += position.shares * (quote?.price ?? 0);
  }
  return cashBalance + equity;
}

export async function fetchDayTraderPositionQuotes(
  positions: readonly { symbol: string }[]
): Promise<Record<string, { price: number }>> {
  const symbols = positions.map((position) => position.symbol);
  const quotes = await fetchCachedStockQuotes(symbols);
  const prices: Record<string, { price: number }> = {};
  for (const [symbol, quote] of Object.entries(quotes)) {
    prices[symbol] = { price: quote.price };
  }
  return prices;
}

export function computeDayTraderFinalMetrics(
  startingValue: number,
  finalValue: number
): { finalDollarGain: number; finalPctGain: number } {
  const finalDollarGain = finalValue - startingValue;
  const finalPctGain =
    startingValue > 0 ? (finalDollarGain / startingValue) * 100 : 0;
  return { finalDollarGain, finalPctGain };
}
