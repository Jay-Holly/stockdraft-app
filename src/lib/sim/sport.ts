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

export function defaultSimSeason(
  sportsStandingsSeason: number | null | undefined
): string {
  if (sportsStandingsSeason != null && sportsStandingsSeason > 0) {
    return String(sportsStandingsSeason);
  }
  return String(new Date().getFullYear());
}
