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
 * All sports-sim leagues share this one season constant. Flipped to 2026
 * NFL data for the SDFL 2026 season launch — MLB/NBA/NHL (SDLB/SDBA/SDHL)
 * do NOT have 2026 data seeded yet and are still only seeded for 2024. As
 * of this flip there are zero non-SDFL sports-sim leagues in existence, so
 * this has no live blast radius — but creating an SDLB/SDBA/SDHL league
 * before those sports get their own 2026 seed data will silently resolve to
 * missing/empty sim_* rows. Revisit this constant (or replace it with a
 * real per-league season selector) before any of those three launch.
 */
export const CURRENT_SIM_SEASON = "2026";

export function defaultSimSeason(
  sportsStandingsSeason: number | null | undefined
): string {
  if (sportsStandingsSeason != null && sportsStandingsSeason > 0) {
    return String(sportsStandingsSeason);
  }
  return CURRENT_SIM_SEASON;
}
