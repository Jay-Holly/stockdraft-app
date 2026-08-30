import type { DraftPick } from "@/lib/draft/types";
import { MAX_ABS_PCT_CHANGE } from "@/lib/market/quote-guards";

/**
 * The value guards, kept pure and free of `server-only`.
 *
 * These decide whether a number is fit to be written as a baseline, which
 * makes them worth testing directly rather than only through a function that
 * needs a database. Restored verbatim from the pre-rebuild canonical scorer;
 * the comments are the original ones and every one of them records a real
 * production incident.
 */

export function computePickMarketValue(pick: DraftPick, price: number): number {
  if (price <= 0) return 0;
  return pick.shares * price;
}

/**
 * A $0 value for a position that actually holds shares means the quote fetch
 * failed — persisting it poisons weekly and season math with a fake -100%.
 * Genuinely empty slots (__OPEN__, 0-share bench) really are $0.
 */
export function isTrustworthyValue(pick: DraftPick, value: number): boolean {
  if (value > 0) return true;
  return pick.shares <= 0 || pick.symbol.toUpperCase() === "__OPEN__";
}

/**
 * A close more than MAX_ABS_PCT_CHANGE from its own open is a corrupted price.
 * Same guard SDDFS/SDWFS apply per pick, extended to season and per-game
 * baselines — one bad row poisons every season-to-date total that sums it.
 */
export function isPlausibleMove(openValue: number, closeValue: number): boolean {
  if (openValue <= 0) return true;
  const pct = Math.abs(((closeValue - openValue) / openValue) * 100);
  return pct <= MAX_ABS_PCT_CHANGE;
}
