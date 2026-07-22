import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { CURRENT_SIM_SEASON } from "@/lib/sim/sport";
import { genericMapSportForLeague, type GenericMapSport } from "@/lib/league/generic-team-map";
import { resolveNbaRealTeamFromSlotKey } from "@/lib/sim/nba-team-alignment";
import { resolveNhlRealTeamFromSlotKey } from "@/lib/sim/nhl-team-alignment";
import { resolveMlbRealTeamFromSlotKey } from "@/lib/sim/mlb-team-alignment";

/**
 * One row per individual real game for SDBA/SDHL/SDLB — unlike
 * ScheduledGame (src/lib/matchup/schedule.ts), which is always exactly one
 * matchup per calendar week. gameDate drives the actual win/loss (that
 * single day's stock/crypto % gain); weekNumber is kept only as the
 * existing "Week N" UI grouping label, derived from the real season's
 * earliest seeded game so it needs no hardcoded per-sport start date.
 */
export type MultiAssetScheduledGame = {
  weekNumber: number;
  gameDate: string;
  /** MLB doubleheaders: 2 for the nightcap, otherwise 1. Distinguishes two real games sharing a date+pairing. */
  gameNumber: number;
  homeUserId: string;
  awayUserId: string;
  isPlayoff: false;
  /** Sequential position across the whole schedule (0-based) — drives the same day-compressed finalize_at pacing SDFL uses via weekNumber. */
  gameIndex: number;
};

const SLOT_KEY_RESOLVERS: Record<GenericMapSport, (slotKey: string) => string> = {
  nba: resolveNbaRealTeamFromSlotKey,
  nhl: resolveNhlRealTeamFromSlotKey,
  mlb: resolveMlbRealTeamFromSlotKey,
};

/** Real team (sim_players.real_team convention) -> claiming user_id, for one league. */
export async function loadMultiAssetFranchiseRealTeamMap(
  supabase: SupabaseClient,
  leagueId: string,
  sport: GenericMapSport
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("league_map_slot_claims")
    .select("user_id, slot_key")
    .eq("league_id", leagueId);

  if (error) throw new Error(error.message);

  const resolve = SLOT_KEY_RESOLVERS[sport];
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (!row.slot_key || !row.user_id) continue;
    map.set(resolve(row.slot_key), row.user_id);
  }
  return map;
}

type GameResultRow = {
  game_date: string | null;
  game_number: number | null;
  home_team: string | null;
  away_team: string | null;
};

function weekNumberForDate(gameDate: string, seasonStartDate: string): number {
  const start = new Date(`${seasonStartDate}T00:00:00Z`);
  const current = new Date(`${gameDate}T00:00:00Z`);
  const daysSinceStart = Math.floor(
    (current.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
  );
  return Math.max(1, Math.floor(daysSinceStart / 7) + 1);
}

/**
 * Mirrors the real 2024/24-25 regular season game-by-game — every franchise
 * inherits its mapped real team's actual schedule, one row per real game
 * (not one per week). Each game is scored independently from that single
 * day's portfolio performance (see the per-game scoring work in
 * lib/matchup/scoring.ts), unlike SDFL's generateSportsSimRegularSeasonSchedule
 * which mirrors NFL 1:1 at true week granularity.
 */
export async function generateMultiAssetRegularSeasonSchedule(
  supabase: SupabaseClient,
  leagueId: string,
  sportsLeagueId: string | null | undefined
): Promise<MultiAssetScheduledGame[]> {
  const sport = genericMapSportForLeague(sportsLeagueId);
  if (!sport) return [];

  const franchiseByTeam = await loadMultiAssetFranchiseRealTeamMap(
    supabase,
    leagueId,
    sport
  );
  if (franchiseByTeam.size === 0) return [];

  const { data: games, error } = await supabase
    .from("sim_game_results")
    .select("game_date, game_number, home_team, away_team")
    .eq("sport", sport)
    .eq("season", CURRENT_SIM_SEASON)
    .order("game_date", { ascending: true })
    .order("game_number", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (games ?? []) as GameResultRow[];
  const firstGameDate = rows.find((r) => r.game_date)?.game_date;
  if (!firstGameDate) return [];

  const dayIndexByDate = new Map<string, number>();
  const schedule: MultiAssetScheduledGame[] = [];
  for (const row of rows) {
    if (!row.game_date || !row.home_team || !row.away_team) continue;
    const homeUserId = franchiseByTeam.get(row.home_team);
    const awayUserId = franchiseByTeam.get(row.away_team);
    if (!homeUserId || !awayUserId) continue;

    // Every pair playing on the same real date shares one day-offset, so the
    // day-compressed finalize pacing advances once per real day, not once
    // per row (a busy day can have several of the league's pairs playing).
    if (!dayIndexByDate.has(row.game_date)) {
      dayIndexByDate.set(row.game_date, dayIndexByDate.size);
    }

    schedule.push({
      weekNumber: weekNumberForDate(row.game_date, firstGameDate),
      gameDate: row.game_date,
      gameNumber: row.game_number ?? 1,
      homeUserId,
      awayUserId,
      isPlayoff: false,
      gameIndex: dayIndexByDate.get(row.game_date)!,
    });
  }

  return schedule;
}
