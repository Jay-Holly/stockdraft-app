import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getLeagueBotMembers } from "@/lib/league/league-bots";
import { normalizePlayerCount } from "@/lib/matchup/schedule";
import {
  computeScoringSeasonGainPercentForUser,
  computeScoringWeekDollarGainForUser,
  computeScoringWeekGainPercentForUser,
} from "@/lib/roster/weekly";
import type { TeamStandingSeed } from "@/lib/matchup/schedule";

export async function getLeaguePlayerCount(leagueId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leagues")
    .select("player_count")
    .eq("id", leagueId)
    .maybeSingle();

  if (data?.player_count) return normalizePlayerCount(data.player_count);

  const bots = await getLeagueBotMembers(leagueId);
  return bots.length + 1;
}

export async function getLeagueTeamIds(
  leagueId: string,
  humanUserId: string
): Promise<string[]> {
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("league_members")
    .select("user_id")
    .eq("league_id", leagueId)
    .order("draft_slot", { ascending: true, nullsFirst: false });

  if (members && members.length > 0) {
    return members.map((member) => member.user_id);
  }

  const bots = await getLeagueBotMembers(leagueId);
  return [humanUserId, ...bots.map((bot) => bot.id)];
}

export async function getLeagueMemberDisplayName(
  leagueId: string,
  userId: string
): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_members")
    .select("display_name")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.display_name) return data.display_name;

  const bots = await getLeagueBotMembers(leagueId);
  return bots.find((bot) => bot.id === userId)?.displayName ?? "Team";
}

export async function computeTeamSeasonGainPercent(
  userId: string,
  leagueId: string
): Promise<number> {
  return computeScoringSeasonGainPercentForUser(userId, leagueId);
}

export async function loadStandingSeeds(
  leagueId: string,
  supabaseOverride?: SupabaseClient
): Promise<TeamStandingSeed[]> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data: rows } = await supabase
    .from("league_standings")
    .select("user_id, wins, losses")
    .eq("league_id", leagueId);

  return Promise.all(
    (rows ?? []).map(async (row) => ({
      userId: row.user_id,
      wins: row.wins,
      losses: row.losses,
      seasonGainPercent: await computeTeamSeasonGainPercent(
        row.user_id,
        leagueId
      ),
    }))
  );
}

export async function computeWeeklyScoreForUser(
  userId: string,
  leagueId: string,
  scoringMode: "percent_gain" | "dollar_gain",
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: Awaited<ReturnType<typeof createClient>>;
  }
): Promise<number> {
  if (scoringMode === "dollar_gain") {
    return computeScoringWeekDollarGainForUser(userId, leagueId, options);
  }
  return computeScoringWeekGainPercentForUser(userId, leagueId, options);
}

export async function syncLeagueCurrentWeek(
  leagueId: string,
  weekNumber: number,
  supabaseOverride?: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const supabase = supabaseOverride ?? (await createClient());

  await supabase
    .from("leagues")
    .update({ current_week: weekNumber })
    .eq("id", leagueId);

  await supabase
    .from("league_standings")
    .update({
      current_week: weekNumber,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId);
}

export async function getScheduledWeekNumbers(
  leagueId: string,
  supabaseOverride?: Awaited<ReturnType<typeof createClient>>
): Promise<number[]> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data } = await supabase
    .from("league_matchups")
    .select("week_number")
    .eq("league_id", leagueId);

  return [...new Set((data ?? []).map((row) => row.week_number))].sort(
    (a, b) => a - b
  );
}
