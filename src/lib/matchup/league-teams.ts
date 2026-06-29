import { createClient } from "@/lib/supabase/server";
import { calculateRosterGainPercent, getScoringPicks } from "@/lib/draft/ai-strategy";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { getLeagueBotMembers } from "@/lib/league/league-bots";
import { normalizePlayerCount } from "@/lib/matchup/schedule";
import {
  computeScoringWeekDollarGainForUser,
  computeScoringWeekGainPercentForUser,
} from "@/lib/roster/weekly";
import { getSymbolQuote } from "@/lib/roster/quotes";
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
  const state = await loadDraftStateDetailed(userId, { leagueId });
  if (!state.ok) return 0;

  const quotes = new Map<string, number>();
  for (const pick of getScoringPicks(state.state.picks)) {
    const { price } = await getSymbolQuote(pick.symbol);
    quotes.set(pick.symbol.toUpperCase(), price);
  }

  return calculateRosterGainPercent(state.state.picks, quotes);
}

export async function loadStandingSeeds(
  leagueId: string
): Promise<TeamStandingSeed[]> {
  const supabase = await createClient();
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
  weekNumber: number
): Promise<void> {
  const supabase = await createClient();

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
  leagueId: string
): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("league_matchups")
    .select("week_number")
    .eq("league_id", leagueId);

  return [...new Set((data ?? []).map((row) => row.week_number))].sort(
    (a, b) => a - b
  );
}
