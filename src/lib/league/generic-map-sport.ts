/**
 * Pure sport-id classification for generic-map leagues (SDBA/SDHL/SDLB) —
 * deliberately has no "server-only" or Supabase import so client components
 * (JoinLeaguePanel, CreateLeagueForm, PublicLeagueList) can import it
 * directly, the same way isSdflLeague works from sdfl-divisions.ts.
 * generic-team-map.ts re-exports these for existing server-side importers.
 */
export type GenericMapSport = "nba" | "nhl" | "mlb";

const SPORTS_LEAGUE_ID_TO_SPORT: Record<string, GenericMapSport> = {
  sdba: "nba",
  sdhl: "nhl",
  sdlb: "mlb",
};

export function genericMapSportForLeague(
  sportsLeagueId: string | null | undefined
): GenericMapSport | null {
  if (!sportsLeagueId) return null;
  return SPORTS_LEAGUE_ID_TO_SPORT[sportsLeagueId] ?? null;
}

export function isGenericMapLeague(
  sportsLeagueId: string | null | undefined
): boolean {
  return genericMapSportForLeague(sportsLeagueId) !== null;
}
