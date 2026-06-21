import { createClient } from "@/lib/supabase/server";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { computeScoringWeekGainPercentForUser } from "@/lib/roster/weekly";
import { listAiLeaguesForUser } from "@/lib/league/active-league";
import { activateAiLeagueSchedule } from "@/lib/league/ai-league";
import { captureWeekBaselinesForLeague } from "@/lib/roster/weekly";

export async function scoreMatchupForLeague(
  userId: string,
  leagueId: string
): Promise<{ error?: string; scored?: boolean }> {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("status")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.status !== "active") {
    return { scored: false };
  }

  const { data: standings } = await supabase
    .from("league_standings")
    .select("*")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!standings) return { error: "Standings not found" };

  const { data: matchup } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", leagueId)
    .eq("week_number", standings.current_week)
    .maybeSingle();

  if (!matchup) return { error: "No matchup scheduled" };
  if (matchup.status === "complete") return { scored: false };

  const humanScore = await computeScoringWeekGainPercentForUser(
    userId,
    leagueId
  );
  const opponentScore = await computeScoringWeekGainPercentForUser(
    matchup.opponent_bot_id,
    leagueId
  );

  let winner: "human" | "opponent" | "tie";
  if (Math.abs(humanScore - opponentScore) < 0.0001) winner = "tie";
  else if (humanScore > opponentScore) winner = "human";
  else winner = "opponent";

  await supabase
    .from("league_matchups")
    .update({
      human_score_pct: humanScore,
      opponent_score_pct: opponentScore,
      winner,
      status: "complete",
      scored_at: new Date().toISOString(),
    })
    .eq("id", matchup.id);

  const wins = standings.wins + (winner === "human" ? 1 : 0);
  const losses = standings.losses + (winner === "opponent" ? 1 : 0);
  const nextWeek = standings.current_week + 1;
  const seasonComplete = nextWeek > 3;

  await supabase
    .from("league_standings")
    .update({
      wins,
      losses,
      current_week: seasonComplete ? standings.current_week : nextWeek,
      updated_at: new Date().toISOString(),
    })
    .eq("league_id", leagueId)
    .eq("user_id", userId);

  if (seasonComplete) {
    await supabase
      .from("leagues")
      .update({ status: "complete" })
      .eq("id", leagueId);
  } else {
    await captureWeekBaselinesForLeague(leagueId, nextWeek);
  }

  return { scored: true };
}

export async function scoreCurrentAiMatchup(
  userId: string
): Promise<{ error?: string; scored?: boolean }> {
  return scoreAllActiveAiMatchups(userId);
}

export async function scoreAllActiveAiMatchups(
  userId: string
): Promise<{ error?: string; scored?: boolean }> {
  const leagues = await listAiLeaguesForUser(userId);
  let scoredAny = false;
  let lastError: string | undefined;

  for (const league of leagues) {
    if (league.status !== "active") continue;
    const result = await scoreMatchupForLeague(userId, league.id);
    if (result.error) lastError = result.error;
    if (result.scored) scoredAny = true;
  }

  return { error: lastError, scored: scoredAny };
}

export async function ensureAiLeagueReadyForMatchups(
  userId: string
): Promise<{ error?: string }> {
  const leagues = await listAiLeaguesForUser(userId);
  const supabase = await createClient();
  let lastError: string | undefined;

  for (const league of leagues) {
    const { data: liveState } = await supabase
      .from("league_draft_state")
      .select("status")
      .eq("league_id", league.id)
      .maybeSingle();

    if (liveState?.status === "complete") {
      const { count } = await supabase
        .from("league_matchups")
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id);

      if (!count || count === 0) {
        const result = await activateAiLeagueSchedule(league.id);
        if (result.error) lastError = result.error;
      }
      continue;
    }

    if (league.status !== "drafting") continue;

    const humanState = await loadDraftStateDetailed(userId, {
      leagueId: league.id,
    });
    if (!humanState.ok) {
      lastError = humanState.error;
      continue;
    }
    if (humanState.state.draft.status !== "complete") continue;

    const result = await activateAiLeagueSchedule(league.id);
    if (result.error) lastError = result.error;
  }

  return lastError ? { error: lastError } : {};
}
