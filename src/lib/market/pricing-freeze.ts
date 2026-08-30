/**
 * The pricing freeze — now OFF.
 *
 * It was switched on by direct instruction on 2026-08-28 as a hard stop on
 * every provider call and on all SDDFS/SDWFS locking and scoring, because the
 * scoring system was being rebuilt underneath and a silent resume could lock
 * or score against half-finished code.
 *
 * The history is worth keeping, because it is the reason this file has no date
 * logic. An earlier version auto-lifted at the next Eastern calendar day with
 * no manual step, and that is exactly what caused the 2026-08-27 SDDFS
 * contests to lock against the wrong opening price: the freeze lifted
 * overnight, and lockDueContests — which had no staleness check — locked a
 * day-old contest using a live quote taken hours after that day's market had
 * closed.
 *
 * Both reasons are now addressed rather than merely waited out:
 *
 *   - The rebuild is finished. Every league can score, every scorer reads the
 *     price log, and no provider call remains outside the logger.
 *   - A contest can no longer lock against a price that is not a real opening
 *     anchor for its own session. It holds instead, visibly, and the hold
 *     appears at /admin/holds.
 *
 * So the condition this freeze was protecting against no longer exists. It
 * stays off until someone sets FROZEN back to true by hand — still no date
 * logic, still no auto-anything, in either direction.
 *
 * NOTE: this takes effect the moment this branch is deployed. Until then it
 * changes nothing, because `main` carries its own copy set to true.
 */
const FROZEN = false;

export function isPricingFrozen(): boolean {
  return FROZEN;
}
