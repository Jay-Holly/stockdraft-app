import { createClient } from "@/lib/supabase/server";
import { activateAiLeagueSchedule } from "@/lib/league/ai-league";
import { captureWeekBaselinesForLeague, captureWeekCloseSnapshots } from "@/lib/roster/weekly";
import { getLastCryptoQuoteSource } from "@/lib/roster/quotes";
import { listAiLeaguesForUser } from "@/lib/league/active-league";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import {
  computeWeeklyScoreForUser,
  getLeagueMemberDisplayName,
  getLeaguePlayerCount,
  getScheduledWeekNumbers,
  loadStandingSeeds,
  syncLeagueCurrentWeek,
} from "@/lib/matchup/league-teams";
import {
  buildChampionshipFromWinners,
  buildFourTeamSemifinals,
  buildTwoTeamChampionship,
  getNextCalendarWeek,
  getRegularSeasonWeeks,
  isRegularSeasonComplete,
  PLAYOFF_START_WEEK,
  SEASON_FINAL_WEEK,
  sortStandingsForSeeding,
  usesFourTeamPlayoff,
  usesTwoTeamPlayoff,
  type ScheduledGame,
} from "@/lib/matchup/schedule";
import {
  legacyWinnerForHuman,
  type LeagueMatchupRow,
} from "@/lib/matchup/types";
import {
  matchupScoreEpsilon,
  parseLeagueScoringMode,
} from "@/lib/league/scoring-mode";

const SCORING_UNAVAILABLE_MESSAGE =
  "Scoring temporarily unavailable — live prices could not be loaded. We'll retry on your next visit.";

const SCORING_DEGRADED_MESSAGE =
  "Week scoring used last-known crypto prices because CoinGecko was temporarily unavailable. Scores will refresh on your next visit.";

async function insertScheduledGames(
  leagueId: string,
  games: ScheduledGame[],
  ownerUserId?: string | null
): Promise<{ error?: string }> {
  if (games.length === 0) return {};

  const supabase = await createClient();
  const rows = await Promise.all(
    games.map(async (game) => {
      const homeName = await getLeagueMemberDisplayName(
        leagueId,
        game.homeUserId
      );
      const awayName = await getLeagueMemberDisplayName(
        leagueId,
        game.awayUserId
      );
      const humanIsHome = ownerUserId && game.homeUserId === ownerUserId;
      const humanIsAway = ownerUserId && game.awayUserId === ownerUserId;

      return {
        league_id: leagueId,
        week_number: game.weekNumber,
        home_user_id: game.homeUserId,
        away_user_id: game.awayUserId,
        is_playoff: game.isPlayoff,
        playoff_round: game.playoffRound ?? null,
        opponent_bot_id: humanIsHome
          ? game.awayUserId
          : humanIsAway
            ? game.homeUserId
            : game.awayUserId,
        opponent_name: humanIsHome
          ? awayName
          : humanIsAway
            ? homeName
            : `${homeName} vs ${awayName}`,
        status: "scheduled" as const,
      };
    })
  );

  const { error } = await supabase.from("league_matchups").insert(rows);
  if (error) return { error: error.message };
  return {};
}

async function seedPlayoffsIfNeeded(
  leagueId: string,
  playerCount: number
): Promise<{ error?: string; seeded?: boolean }> {
  const supabase = await createClient();

  const { count: playoffCount } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("is_playoff", true);

  if (playoffCount && playoffCount > 0) {
    return { seeded: false };
  }

  const seeds = sortStandingsForSeeding(await loadStandingSeeds(leagueId));
  if (seeds.length < 2) {
    return { error: "Not enough teams to seed playoffs." };
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  let games: ScheduledGame[] = [];

  if (usesTwoTeamPlayoff(playerCount)) {
    games = [
      buildTwoTeamChampionship(
        SEASON_FINAL_WEEK,
        seeds[0].userId,
        seeds[1].userId
      ),
    ];
  } else if (usesFourTeamPlayoff(playerCount)) {
    if (seeds.length < 4) {
      return { error: "Not enough teams for a four-team playoff bracket." };
    }
    games = buildFourTeamSemifinals(PLAYOFF_START_WEEK, [
      seeds[0].userId,
      seeds[1].userId,
      seeds[2].userId,
      seeds[3].userId,
    ]);
  }

  const result = await insertScheduledGames(
    leagueId,
    games,
    league?.owner_user_id
  );
  if (result.error) return result;
  return { seeded: true };
}

async function seedChampionshipIfNeeded(
  leagueId: string
): Promise<{ error?: string; seeded?: boolean }> {
  const supabase = await createClient();

  const { count: finalCount } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("is_playoff", true)
    .eq("playoff_round", "final");

  if (finalCount && finalCount > 0) {
    return { seeded: false };
  }

  const { data: semis } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", leagueId)
    .eq("week_number", PLAYOFF_START_WEEK)
    .eq("playoff_round", "semifinal")
    .eq("status", "complete");

  if (!semis || semis.length < 2) {
    return { seeded: false };
  }

  const winners = semis.map((row) => row.winner_user_id).filter(Boolean) as string[];
  if (winners.length !== 2) {
    return { error: "Could not determine championship participants." };
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  const result = await insertScheduledGames(
    leagueId,
    [buildChampionshipFromWinners(SEASON_FINAL_WEEK, winners[0], winners[1])],
    league?.owner_user_id
  );
  if (result.error) return result;
  return { seeded: true };
}

async function scoreSingleMatchup(
  matchup: LeagueMatchupRow,
  scoringMode: ReturnType<typeof parseLeagueScoringMode>
): Promise<{ error?: string }> {
  if (
    !matchup.home_user_id ||
    !matchup.away_user_id ||
    matchup.status === "complete"
  ) {
    return {};
  }

  const supabase = await createClient();
  let homeScore: number;
  let awayScore: number;

  try {
    homeScore = await computeWeeklyScoreForUser(
      matchup.home_user_id,
      matchup.league_id,
      scoringMode
    );
    awayScore = await computeWeeklyScoreForUser(
      matchup.away_user_id,
      matchup.league_id,
      scoringMode
    );
  } catch (error) {
    console.error(
      `scoreSingleMatchup failed league=${matchup.league_id} matchup=${matchup.id}:`,
      error
    );
    return { error: SCORING_UNAVAILABLE_MESSAGE };
  }

  const epsilon = matchupScoreEpsilon(scoringMode);
  let winnerUserId: string | null;
  if (Math.abs(homeScore - awayScore) < epsilon) {
    winnerUserId = null;
  } else if (homeScore > awayScore) {
    winnerUserId = matchup.home_user_id;
  } else {
    winnerUserId = matchup.away_user_id;
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("owner_user_id")
    .eq("id", matchup.league_id)
    .maybeSingle();

  const humanUserId = league?.owner_user_id ?? null;
  let legacyWinner: string | null = null;
  if (humanUserId) {
    legacyWinner = legacyWinnerForHuman(
      {
        ...matchup,
        winner_user_id: winnerUserId,
        status: "complete",
      },
      humanUserId
    );
  }

  const updatePayload: Record<string, unknown> = {
    home_score: homeScore,
    away_score: awayScore,
    winner_user_id: winnerUserId,
    status: "complete",
    scored_at: new Date().toISOString(),
  };

  if (
    humanUserId &&
    (matchup.home_user_id === humanUserId || matchup.away_user_id === humanUserId)
  ) {
    updatePayload.human_score_pct =
      humanUserId === matchup.home_user_id ? homeScore : awayScore;
    updatePayload.opponent_score_pct =
      humanUserId === matchup.home_user_id ? awayScore : homeScore;
    updatePayload.winner = legacyWinner;
  }

  const { error } = await supabase
    .from("league_matchups")
    .update(updatePayload)
    .eq("id", matchup.id);

  if (error) return { error: error.message };
  return {};
}

async function applyStandingsForCompletedWeek(
  leagueId: string,
  weekNumber: number
): Promise<void> {
  const supabase = await createClient();
  const { data: completed } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "complete");

  for (const matchup of completed ?? []) {
    if (!matchup.home_user_id || !matchup.away_user_id) continue;

    for (const userId of [matchup.home_user_id, matchup.away_user_id]) {
      const { data: row } = await supabase
        .from("league_standings")
        .select("wins, losses")
        .eq("league_id", leagueId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!row) continue;

      let wins = row.wins;
      let losses = row.losses;

      if (matchup.winner_user_id === userId) {
        wins += 1;
      } else if (matchup.winner_user_id) {
        losses += 1;
      }

      await supabase
        .from("league_standings")
        .update({
          wins,
          losses,
          updated_at: new Date().toISOString(),
        })
        .eq("league_id", leagueId)
        .eq("user_id", userId);
    }
  }
}

async function advanceLeagueCalendar(
  leagueId: string,
  playerCount: number,
  currentWeek: number
): Promise<{ seasonComplete?: boolean; nextWeek?: number }> {
  const supabase = await createClient();
  const scheduledWeeks = await getScheduledWeekNumbers(leagueId);

  if (
    isRegularSeasonComplete(currentWeek, playerCount) &&
    !scheduledWeeks.some((week) => week > getRegularSeasonWeeks(playerCount))
  ) {
    await seedPlayoffsIfNeeded(leagueId, playerCount);
  }

  if (
    currentWeek === PLAYOFF_START_WEEK &&
    usesFourTeamPlayoff(playerCount)
  ) {
    await seedChampionshipIfNeeded(leagueId);
  }

  const refreshedWeeks = await getScheduledWeekNumbers(leagueId);
  const nextWeek = getNextCalendarWeek(currentWeek, refreshedWeeks);

  if (!nextWeek) {
    await supabase
      .from("leagues")
      .update({ status: "complete" })
      .eq("id", leagueId);
    return { seasonComplete: true };
  }

  await syncLeagueCurrentWeek(leagueId, nextWeek);
  await captureWeekBaselinesForLeague(leagueId, nextWeek);
  return { seasonComplete: false, nextWeek };
}

export async function scoreMatchupForLeague(
  userId: string,
  leagueId: string
): Promise<{ error?: string; notice?: string; scored?: boolean }> {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("status, scoring_mode, current_week, owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.status !== "active") {
    return { scored: false };
  }

  const scoringMode = parseLeagueScoringMode(league.scoring_mode);
  const playerCount = await getLeaguePlayerCount(leagueId);

  const { data: humanStandings } = await supabase
    .from("league_standings")
    .select("current_week")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!humanStandings) return { error: "Standings not found" };

  const currentWeek = league.current_week ?? humanStandings.current_week ?? 1;

  const { data: weekMatchups } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", leagueId)
    .eq("week_number", currentWeek)
    .eq("status", "scheduled");

  if (!weekMatchups?.length) {
    const { count: anyMatchups } = await supabase
      .from("league_matchups")
      .select("*", { count: "exact", head: true })
      .eq("league_id", leagueId);

    if (!anyMatchups) {
      return { error: "No matchups scheduled" };
    }

    const advance = await advanceLeagueCalendar(
      leagueId,
      playerCount,
      currentWeek
    );
    if (advance.seasonComplete) return { scored: false };
    return scoreMatchupForLeague(userId, leagueId);
  }

  let lastError: string | undefined;

  for (const matchup of weekMatchups as LeagueMatchupRow[]) {
    const result = await scoreSingleMatchup(matchup, scoringMode);
    if (result.error) lastError = result.error;
  }

  if (lastError) {
    return { error: lastError, scored: false };
  }

  await captureWeekCloseSnapshots(leagueId, currentWeek);
  await applyStandingsForCompletedWeek(leagueId, currentWeek);

  const cryptoSource = getLastCryptoQuoteSource();
  const notice =
    cryptoSource && cryptoSource !== "live" ? SCORING_DEGRADED_MESSAGE : undefined;

  await advanceLeagueCalendar(leagueId, playerCount, currentWeek);

  return { scored: true, notice };
}

export async function scoreCurrentAiMatchup(
  userId: string
): Promise<{ error?: string; scored?: boolean }> {
  return scoreAllActiveAiMatchups(userId);
}

export async function scoreAllActiveAiMatchups(
  userId: string
): Promise<{ error?: string; notice?: string; scored?: boolean }> {
  const leagues = await listAiLeaguesForUser(userId);
  let scoredAny = false;
  let lastError: string | undefined;
  let lastNotice: string | undefined;

  for (const league of leagues) {
    if (league.status !== "active") continue;
    const result = await scoreMatchupForLeague(userId, league.id);
    if (result.error) lastError = result.error;
    if (result.notice) lastNotice = result.notice;
    if (result.scored) scoredAny = true;
  }

  return {
    error: lastError,
    notice: lastNotice,
    scored: scoredAny,
  };
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
        const result = await activateAiLeagueSchedule(league.id, userId);
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

    const result = await activateAiLeagueSchedule(league.id, userId);
    if (result.error) lastError = result.error;
  }

  return lastError ? { error: lastError } : {};
}
