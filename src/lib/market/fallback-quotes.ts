/**
 * There is no fallback quote any more, and that is the point.
 *
 * This module used to serve prices from `src/data/sp500-fallback-quotes.json`,
 * a snapshot committed to the repo, whenever a live quote was unavailable. A
 * price nobody observed is not a price: served into a draft it sets the shares
 * a manager holds forever, and served into a portfolio it decides a rank.
 *
 * The price log removed the need for it. The logger sweeps all 552 symbols
 * every minute and records what it got, so "no live quote" now means the log
 * genuinely has nothing — and the honest answer to that is nothing, not a
 * number from a file.
 *
 * Every caller already handles an absent quote: usePoolQuotes skips the symbol,
 * the draft's price lookup falls through to 0 which its own guards reject, and
 * the market API omits it. Nothing needs a fabricated number to keep working.
 */

export type FallbackQuote = {
  price: number;
  prevClose: number;
  changePercent: number;
};

/** Always null. See above — an unobserved price is not a price. */
export function getFallbackStockQuote(_symbol: string): FallbackQuote | null {
  return null;
}

/**
 * Always empty. This existed so autopick had a symbol list when the draft pool
 * came back empty; an empty draft pool is a real failure that should surface,
 * not be papered over with a stale list from a file.
 */
export function listFallbackPoolSymbols(): string[] {
  return [];
}

/**
 * Passes live quotes through unchanged. A symbol with no live quote is absent
 * from the result rather than filled in.
 */
export function mergeQuotesWithFallback<T>(
  _symbols: readonly string[],
  live: Record<string, T>
): Record<string, T> {
  return live;
}
