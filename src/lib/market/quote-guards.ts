/**
 * Guards against scoring contests on bad price data.
 *
 * Both SDDFS and SDWFS score a pick by comparing a snapshotted open price to a
 * later quote. When the price feed fails it yields 0/undefined, and unguarded
 * arithmetic turns that into a confident, wrong number:
 *
 *   - a missing close quote scores as exactly -100% (pick wiped out)
 *   - a junk open price of $0.15 on an $86 stock scores as +57,320%
 *
 * Both have happened in production and decided real payouts, so every write of
 * open_price / pct_change goes through here.
 */

/**
 * A single pick moving more than this within one contest is a data error, not a
 * trade. Generous enough for a genuine crypto or meme-stock run; tight enough
 * to catch a corrupted baseline.
 */
export const MAX_ABS_PCT_CHANGE = 500;

/** True only for a real, positive, finite price. */
export function isUsableQuote(price: unknown): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

/**
 * Percent change, or null when the inputs can't support one. Null is the
 * neutral outcome — scoring sums `pct_change ?? 0`, so a failed quote neither
 * helps nor hurts the player, instead of wiping them out at -100%.
 */
export function safePctChange(
  openPrice: unknown,
  closePrice: unknown
): number | null {
  if (!isUsableQuote(openPrice) || !isUsableQuote(closePrice)) return null;

  const pct = ((closePrice - openPrice) / openPrice) * 100;
  if (!Number.isFinite(pct)) return null;
  if (Math.abs(pct) > MAX_ABS_PCT_CHANGE) return null;

  return pct;
}
