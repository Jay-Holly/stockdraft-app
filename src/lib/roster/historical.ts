/**
 * PLACEHOLDER — not a rebuild. See leaderboard.ts and portfolio-value.ts in
 * src/lib/day-trader/ for the full explanation: 31 files were deleted at
 * the start of the scoring-rebuild branch (2026-08-27), and this dev server
 * points at the live production database, not a sandbox.
 *
 * Every export below is synchronous even where the real function will be
 * async, on purpose: a sync throw propagates correctly whether or not a
 * caller awaits it; an async stub that a caller doesn't await would hand
 * back a Promise object instead of throwing, which is a worse, quieter
 * failure than the one this file exists to prevent.
 *
 * Two behaviors, chosen per export, never guessed at random:
 *   - A function whose job is to WRITE, COMPUTE a business number, or DECIDE
 *     an outcome throws immediately. Faking that value is how a $0.15 open
 *     scored a stock at +57,320% the first time. A loud error beats a quiet
 *     wrong number.
 *   - A function whose job is a plain READ (a quote, a list, a lookup) that
 *     found nothing returns an honestly empty result — the same shape a real
 *     "no rows" answer would have. That is not a fabrication; it is what an
 *     empty result actually looks like.
 *
 * Rebuild this against the real logic (and the new pricing module) before
 * relying on it for anything that touches money or a real score.
 */

function notImplemented(name: string): Error {
  return new Error(
    `${name}: not implemented — deleted in the scoring-rebuild branch cleanup ` +
    `(2026-08-27), not yet rebuilt. See SCORING_REBUILD_HANDOFF_2026-08-28.md.`
  );
}

type RosterPickView = import("@/lib/roster/types").RosterPickView;

export function buildHistoricalRosterPicks(...args: unknown[]): RosterPickView[] {
  return [];
}

export type PartitionedRosterPicks = {
  starters: RosterPickView[];
  bench: RosterPickView[];
  ir: RosterPickView[];
  crypto: RosterPickView[];
};

export function partitionHistoricalRosterPicks(
  ...args: unknown[]
): PartitionedRosterPicks {
  throw notImplemented("partitionHistoricalRosterPicks");
}

