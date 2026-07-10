import { parseSportsLeagueId, type SportsLeagueId } from "@/lib/league/sports-league-standings";
import type { SimSport } from "@/lib/sim/types";

const SPORTS_LEAGUE_TO_SIM_SPORT: Record<SportsLeagueId, SimSport> = {
  sdfl: "nfl",
  sdhl: "nhl",
  sdba: "nba",
  sdlb: "mlb",
};

export function sportsLeagueIdToSimSport(
  sportsLeagueId: string | null | undefined
): SimSport | null {
  const parsed = parseSportsLeagueId(sportsLeagueId);
  if (!parsed) return null;
  return SPORTS_LEAGUE_TO_SIM_SPORT[parsed];
}

export function simSportUsesWeekNumbers(sport: SimSport): boolean {
  return sport === "nfl";
}

/**
 * All sports-sim leagues are currently anchored to the 2024-25 real season —
 * the only season with seeded player/injury data. A calendar-year fallback
 * would silently drift wrong once the real year moves past 2024, so this
 * stays a fixed default until multi-season data (and a real per-league
 * season selector) exists.
 */
export const CURRENT_SIM_SEASON = "2024";

export function defaultSimSeason(
  sportsStandingsSeason: number | null | undefined
): string {
  if (sportsStandingsSeason != null && sportsStandingsSeason > 0) {
    return String(sportsStandingsSeason);
  }
  return CURRENT_SIM_SEASON;
}
