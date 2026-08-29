import "server-only";

/**
 * PLACEHOLDER for the quote-fetching piece only — see leaderboard.ts for the
 * same situation and why it exists (31 files deleted at the start of the
 * scoring-rebuild branch, this one not yet rebuilt against the new pricing
 * module).
 *
 * The two compute functions below are plain arithmetic with no data source of
 * their own — they are implemented for real, not stubbed, because there is
 * nothing to fabricate: they just add up whatever numbers they're handed.
 *
 * `fetchDayTraderPositionQuotes` is the one piece that actually needs a price
 * source. It intentionally does NOT call `getPrices` from `@/lib/pricing` —
 * that reader path still live-fetches on a cache miss and does not check
 * `isPricingFrozen()` (a known gap, see SCORING_REBUILD_HANDOFF §7), so
 * wiring it here would let a Day Trader page load spend live Finnhub calls
 * that bypass the freeze entirely. Returning no quotes is the honest answer
 * until Day Trader is deliberately wired to the price log with its own
 * freshness rule — a missing price becomes $0 of market value for that
 * position (see the `?? 0` at each call site), not a guessed price, which
 * matches how every other gap in this system is meant to fail.
 */

export type DayTraderQuote = { price: number };
export type DayTraderQuoteMap = Record<string, DayTraderQuote>;

export async function fetchDayTraderPositionQuotes(
  _positions: readonly { symbol: string }[]
): Promise<DayTraderQuoteMap> {
  return {};
}

export function computeDayTraderEntryValue(
  cashBalance: number,
  positions: readonly { symbol: string; shares: number }[],
  quotes: DayTraderQuoteMap
): number {
  const positionsValue = positions.reduce((sum, position) => {
    const price = quotes[position.symbol]?.price ?? 0;
    return sum + position.shares * price;
  }, 0);
  return cashBalance + positionsValue;
}

export function computeDayTraderFinalMetrics(
  startingValue: number,
  finalValue: number
): { finalDollarGain: number; finalPctGain: number } {
  const finalDollarGain = finalValue - startingValue;
  const finalPctGain = startingValue > 0 ? (finalDollarGain / startingValue) * 100 : 0;
  return { finalDollarGain, finalPctGain };
}
