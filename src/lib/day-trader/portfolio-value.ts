import "server-only";

import { getLatestPrices } from "@/lib/pricing/read";

export type DayTraderStockQuote = {
  price: number;
  changePercent: number;
  prevClose: number;
};

export function computeDayTraderEntryValue(
  cashBalance: number,
  positions: readonly { symbol: string; shares: number }[],
  quotes: Record<string, Pick<DayTraderStockQuote, "price">>
): number {
  let equity = 0;
  for (const position of positions) {
    const quote = quotes[position.symbol.toUpperCase()];
    equity += position.shares * (quote?.price ?? 0);
  }
  return cashBalance + equity;
}

/**
 * Prices for a Day Trader entry's positions, from the price log.
 *
 * This used to read a cached quote table and, for anything the cache had not
 * heard of, fall back to a hardcoded quote committed to the repo months
 * earlier. That fallback is the reason this is repointed rather than restored:
 * a price nobody observed is not a price, and serving one into a portfolio
 * valuation makes an entry's worth — and therefore its rank and its payout —
 * a number derived from a stale file.
 *
 * A symbol the log has no price for is now simply ABSENT from the result.
 * `computeDayTraderEntryValue` already treats an absent quote as contributing
 * nothing, and the leaderboard can see that a position could not be valued
 * instead of ranking it against fiction.
 */
export async function fetchDayTraderPositionQuotes(
  positions: readonly { symbol: string }[]
): Promise<Record<string, DayTraderStockQuote>> {
  const symbols = [
    ...new Set(positions.map((position) => String(position.symbol).toUpperCase())),
  ].filter(Boolean);
  if (symbols.length === 0) return {};

  const lookup = await getLatestPrices(symbols);
  const quotes: Record<string, DayTraderStockQuote> = {};

  for (const [symbol, hit] of lookup.hits) {
    const changePercent = hit.changePercent ?? 0;
    // Derived from the provider's own change rather than invented: with no
    // change reported, prevClose equals the price and the move shows as flat,
    // which is the truthful "we do not know" rendering.
    const prevClose =
      changePercent !== 0 ? hit.price / (1 + changePercent / 100) : hit.price;
    quotes[symbol] = { price: hit.price, changePercent, prevClose };
  }

  if (lookup.misses.size > 0) {
    console.warn(
      `[day-trader] no usable price for ${lookup.misses.size} position symbol(s): ` +
        [...lookup.misses.keys()].slice(0, 10).join(", ")
    );
  }

  return quotes;
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
