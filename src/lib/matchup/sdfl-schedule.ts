import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScheduledGame } from "@/lib/matchup/schedule";
import { mapSdflSlotToRealTeam } from "@/lib/sim/nfl-team-alignment";
import { CURRENT_SIM_SEASON } from "@/lib/sim/sport";
import type {
  SdflConference,
  SdflDivision,
} from "@/lib/league/sdfl-divisions";

export const SDFL_REGULAR_SEASON_WEEKS = 18;
export const SDFL_WILD_CARD_WEEK = 19;
export const SDFL_DIVISIONAL_WEEK = 20;
export const SDFL_CONFERENCE_CHAMPIONSHIP_WEEK = 21;
export const SDFL_FINAL_WEEK = 22;

type IdentityRow = {
  user_id: string;
  conference: SdflConference | null;
  division: SdflDivision | null;
  division_slot: number | null;
};

/**
 * Builds each franchise's real 2024 NFL team assignment from its claimed
 * conference/division/slot. Only rows with a complete identity are mapped —
 * incomplete rows are silently skipped (the draft gate already requires all
 * 32 slots filled before a draft can start, so in practice this is empty).
 */
export async function loadFranchiseRealTeamMap(
  supabase: SupabaseClient,
  leagueId: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("league_members")
    .select("user_id, conference, division, division_slot")
    .eq("league_id", leagueId);

  if (error) throw new Error(error.message);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as IdentityRow[]) {
    if (!row.conference || !row.division || !row.division_slot) continue;
    const team = mapSdflSlotToRealTeam(
      row.conference,
      row.division,
      row.division_slot
    );
    if (team) map.set(row.user_id, team);
  }
  return map;
}

type GameResultRow = {
  week: number | null;
  home_team: string | null;
  away_team: string | null;
};

/**
 * Mirrors the real 2024 NFL regular season 1:1 — each franchise inherits its
 * mapped real team's actual week-by-week opponent sequence (including byes,
 * which simply produce no game that week for the team on bye).
 */
export async function generateSportsSimRegularSeasonSchedule(
  supabase: SupabaseClient,
  leagueId: string
): Promise<ScheduledGame[]> {
  const franchiseByTeam = new Map<string, string>();
  const teamByFranchise = await loadFranchiseRealTeamMap(supabase, leagueId);
  for (const [userId, team] of teamByFranchise) {
    franchiseByTeam.set(team, userId);
  }

  if (franchiseByTeam.size === 0) return [];

  const { data: games, error } = await supabase
    .from("sim_game_results")
    .select("week, home_team, away_team")
    .eq("sport", "nfl")
    .eq("season", CURRENT_SIM_SEASON)
    .order("week", { ascending: true });

  if (error) throw new Error(error.message);

  const schedule: ScheduledGame[] = [];
  for (const row of (games ?? []) as GameResultRow[]) {
    if (!row.week || !row.home_team || !row.away_team) continue;
    const homeUserId = franchiseByTeam.get(row.home_team);
    const awayUserId = franchiseByTeam.get(row.away_team);
    if (!homeUserId || !awayUserId) continue;

    schedule.push({
      weekNumber: row.week,
      homeUserId,
      awayUserId,
      isPlayoff: false,
    });
  }

  return schedule;
}
