/**
 * Hard stop on every Finnhub and Twelve Data call, and on all SDDFS/SDWFS
 * locking and scoring, indefinitely — by direct instruction, 2026-08-28.
 *
 * The previous version of this freeze auto-lifted at the next Eastern
 * calendar day with no manual step. That is what caused the 2026-08-27
 * SDDFS contests to lock with the wrong "open" price the moment it lifted
 * overnight: lockDueContests has no staleness check, so it locked a
 * day-old contest using a live quote taken hours after that day's market
 * had already closed. An auto-resuming freeze is not safe while the
 * scoring system itself is being rebuilt (see the `scoring-rebuild`
 * branch) — a silent resume could lock/score against half-finished code.
 *
 * This freeze stays on until someone changes FROZEN to false by hand and
 * ships it. No date logic, no auto-lift.
 */
const FROZEN = true;

export function isPricingFrozen(): boolean {
  return FROZEN;
}
