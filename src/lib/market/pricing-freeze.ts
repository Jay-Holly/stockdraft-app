import { easternDateIso } from "@/lib/dfs/audit-dates";

/**
 * Hard stop on every Finnhub and Twelve Data call, for the rest of today.
 *
 * On 2026-08-27, Twelve Data reported 6,761 credits used against the 800/day
 * cap — almost entirely 8 zombie SDDFS contests (8/19, 8/21) that can never
 * resolve, retrying an uncapped historical-bar request every 15 minutes and
 * burning the whole daily budget before anything legitimate got a turn. By
 * direct instruction: no locking, no scoring, no quote fetching of any kind
 * from either provider until the next Eastern calendar day starts — so
 * tomorrow opens with both APIs' full budget available, guaranteed.
 *
 * Freezes by comparing today's Eastern date against a fixed cutoff rather
 * than a timer or env var, so it lifts itself the moment the calendar rolls
 * over with no manual step required.
 */
const FROZEN_THROUGH_DATE = "2026-08-27";

export function isPricingFrozen(): boolean {
  return easternDateIso() <= FROZEN_THROUGH_DATE;
}
