/**
 * Types for future pro-league prior-season standings ingestion.
 * See sports-league-draft-order.ts for refresh timing and UI restrictions.
 */

export type SportsLeagueId = "sdfl" | "sdhl" | "sdba" | "sdlb";

export type ProLeagueKey = "NFL" | "NHL" | "NBA" | "MLB";

export const SPORTS_LEAGUE_TO_PRO_LEAGUE: Record<SportsLeagueId, ProLeagueKey> = {
  sdfl: "NFL",
  sdhl: "NHL",
  sdba: "NBA",
  sdlb: "MLB",
};

/** Future table shape — not persisted yet beyond leagues.sports_standings_season. */
export type ProStandingsSnapshot = {
  proLeague: ProLeagueKey;
  seasonYear: number;
  /** Finish rank 1 = champion; used internally only. */
  finishRankByFranchiseKey: Record<string, number>;
  capturedAt: string;
  championshipCompletedAt: string;
};

export function parseSportsLeagueId(
  value: string | null | undefined
): SportsLeagueId | null {
  if (value === "sdfl" || value === "sdhl" || value === "sdba" || value === "sdlb") {
    return value;
  }
  return null;
}
