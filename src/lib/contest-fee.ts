/**
 * The platform fee, in one place.
 *
 * Six files each multiplied by a bare `0.92` — the DFS and WFS contest
 * helpers, both leaderboards, and both scorers. Changing the fee meant finding
 * all six, and missing one would have been quiet and expensive: a leaderboard
 * advertising one prize pool while the scorer paid out a different number.
 *
 * `PLATFORM_FEE_RATE` is what the platform withholds. `PRIZE_POOL_RATE` is what
 * the entrants split. They always sum to 1 — derive the second from the first
 * rather than writing both down and letting them drift apart.
 */
export const PLATFORM_FEE_RATE = 0.1;

export const PRIZE_POOL_RATE = 1 - PLATFORM_FEE_RATE;

/**
 * Entry fees collected, less the platform fee, rounded to whole cents.
 *
 * Every prize pool in the app comes from here. Rounding lives inside the
 * function for the same reason the rate does: two call sites rounding
 * differently is the same bug in a smaller disguise.
 */
export function prizePoolFromEntries(buyIn: number, entrants: number): number {
  return Math.round(buyIn * entrants * PRIZE_POOL_RATE * 100) / 100;
}
