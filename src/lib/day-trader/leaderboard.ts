/**
 * PLACEHOLDER — not a rebuild of Day Trader leaderboard scoring.
 *
 * This file was one of 31 deleted at the start of the scoring-rebuild branch
 * (2026-08-27). It is on the tracked rebuild list (SCORING_REBUILD_HANDOFF,
 * §8 — dashboard-summary.ts et al.) and needs real logic once the new
 * pricing/scoring engine exists.
 *
 * Right now it exists only to stop a "module not found" build error from
 * blocking every page in dev (Next's dev overlay is app-wide, not
 * route-scoped, so one broken import anywhere hijacks pages that have
 * nothing to do with it — including the new admin Prices page).
 *
 * It returns an empty leaderboard rather than any computed value — an empty
 * board is honest; a guessed one is exactly the failure mode the rest of
 * this rebuild exists to remove. Do not fill this in with placeholder
 * numbers. Rebuild it against real portfolio values once Day Trader is
 * wired to the new pricing module.
 */

export type DayTraderLeaderboardMetric = "dollar" | "percent";

export type DayTraderLeaderboardRow = {
  entryId: string;
  rank: number;
  userId: string;
  username: string;
  teamName: string;
  score: number;
  dollarGain: number;
  percentGain: number;
  isLive: boolean;
};

export async function loadDayTraderDollarLeaderboard(
  _contestId: string
): Promise<DayTraderLeaderboardRow[]> {
  return [];
}

export async function loadDayTraderPercentLeaderboard(
  _contestId: string
): Promise<DayTraderLeaderboardRow[]> {
  return [];
}
