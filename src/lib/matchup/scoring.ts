import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { allocatePlayoffBonusPoolIfNeeded } from "@/lib/awards/allocate";
import { autoClaimPlayoffPayoutsForAllocation } from "@/lib/awards/claim";
import { activateAiLeagueSchedule } from "@/lib/league/ai-league";
import {
  captureWeekBaselinesForLeague,
  captureWeekCloseSnapshots,
} from "@/lib/roster/weekly";
import { getLastCryptoQuoteSource } from "@/lib/roster/quotes";
import { listAiLeaguesForUser } from "@/lib/league/active-league";
import { loadDraftStateDetailed } from "@/lib/draft/server";
import { runSportsSimIrWeeklyCheck } from "@/lib/sim/ir-enforcement";
import { ensureIrSlotsForLeague } from "@/lib/sim/ir-slots";
import { isSportsSimLeague } from "@/lib/season/sdpl-league";
import {
  canFinalizeLeagueWeek,
  setNextWeekFinalizeAt,
} from "@/lib/matchup/finalize-week";
import { loadSeasonCalendarForLeague } from "@/lib/season/settings-server";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import { SDPL_REGULAR_SEASON_WEEKS } from "@/lib/season/constants";
import {
  SDFL_CONFERENCE_CHAMPIONSHIP_WEEK,
  SDFL_DIVISIONAL_WEEK,
  SDFL_REGULAR_SEASON_WEEKS,
  SDFL_WILD_CARD_WEEK,
} from "@/lib/matchup/sdfl-schedule";
import {
  isSportsSimRegularSeasonComplete,
  seedSdflConferenceChampionshipIfNeeded,
  seedSdflDivisionalIfNeeded,
  seedSdflFinalIfNeeded,
  seedSdflWildCardIfNeeded,
} from "@/lib/matchup/sdfl-playoffs";
import {
  usesSameDayCloseCapture,
  weekUsesWeekendExtension,
} from "@/lib/season/finalize-times";
import { baselinesHaveFridayClose } from "@/lib/season/weekend-scoring";
import { loadWeekBaselineExtendedMap } from "@/lib/roster/weekly";
import {
  computeWeeklyScoreForUser,
  getLeagueMemberDisplayName,
  getLeaguePlayerCount,
  getScheduledWeekNumbers,
  loadStandingSeeds,
  syncLeagueCurrentWeek,
} from "@/lib/matchup/league-teams";
import {
  buildFourTeamSemifinals,
  buildPlayoffFinalsWeek,
  buildTwoTeamChampionship,
  getNextCalendarWeek,
  getRegularSeasonWeeks,
  getSdplPlayoffWeeks,
  isRegularSeasonComplete,
  isSdplRegularSeasonComplete,
  partitionSemifinalResults,
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

export async function insertScheduledGames(
  leagueId: string,
  games: ScheduledGame[],
  ownerUserId?: string | null,
  supabaseOverride?: SupabaseClient
): Promise<{ error?: string }> {
  if (games.length === 0) return {};

  const supabase = supabaseOverride ?? (await createClient());
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
        ...(game.finalizeAt ? { finalize_at: game.finalizeAt } : {}),
      };
    })
  );

  const { error } = await supabase.from("league_matchups").insert(rows);
  if (error) return { error: error.message };
  return {};
}

async function seedPlayoffsIfNeeded(
  leagueId: string,
  playerCount: number,
  options?: { sdpl?: boolean; semifinalWeek?: number }
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

  if (options?.sdpl) {
    if (seeds.length < 4) {
      return { error: "Not enough teams for SDPL playoffs (top 4 required)." };
    }
    games = buildFourTeamSemifinals(
      options.semifinalWeek ?? getSdplPlayoffWeeks(SDPL_REGULAR_SEASON_WEEKS).semifinalWeek,
      [
        seeds[0].userId,
        seeds[1].userId,
        seeds[2].userId,
        seeds[3].userId,
      ]
    );
  } else if (usesTwoTeamPlayoff(playerCount)) {
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

async function seedPlayoffFinalsIfNeeded(
  leagueId: string,
  semifinalWeek: number,
  finalsWeek: number
): Promise<{ error?: string; seeded?: boolean }> {
  const supabase = await createClient();

  const { count: finalsWeekCount } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("week_number", finalsWeek)
    .eq("is_playoff", true);

  if (finalsWeekCount && finalsWeekCount > 0) {
    return { seeded: false };
  }

  const { data: semis } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id")
    .eq("league_id", leagueId)
    .eq("week_number", semifinalWeek)
    .eq("playoff_round", "semifinal")
    .eq("status", "complete");

  const partitioned = partitionSemifinalResults(semis ?? []);
  if (!partitioned) {
    return { seeded: false };
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  const games = buildPlayoffFinalsWeek(
    finalsWeek,
    partitioned.winners,
    partitioned.losers
  );

  const result = await insertScheduledGames(
    leagueId,
    games,
    league?.owner_user_id
  );
  if (result.error) return result;
  return { seeded: true };
}

/** Legacy sports-sim path: championship only, no 3rd-place game. */
async function seedLegacyChampionshipIfNeeded(
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
    .select("home_user_id, away_user_id, winner_user_id")
    .eq("league_id", leagueId)
    .eq("week_number", PLAYOFF_START_WEEK)
    .eq("playoff_round", "semifinal")
    .eq("status", "complete");

  const partitioned = partitionSemifinalResults(semis ?? []);
  if (!partitioned) {
    return { seeded: false };
  }

  const { data: league } = await supabase
    .from("leagues")
    .select("owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  const result = await insertScheduledGames(
    leagueId,
    [
      buildTwoTeamChampionship(
        SEASON_FINAL_WEEK,
        partitioned.winners[0],
        partitioned.winners[1]
      ),
    ],
    league?.owner_user_id
  );
  if (result.error) return result;
  return { seeded: true };
}

/**
 * Winner on the league's primary scoring metric; if that's a true tie
 * within epsilon, break it on the OTHER metric ($ gain decides a % league,
 * % gain decides a $ league) before falling back to a genuine tie.
 */
export async function resolveMatchupWinner(
  homeUserId: string,
  awayUserId: string,
  leagueId: string,
  scoringMode: ReturnType<typeof parseLeagueScoringMode>,
  homeScore: number,
  awayScore: number,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: SupabaseClient;
  }
): Promise<string | null> {
  const epsilon = matchupScoreEpsilon(scoringMode);
  if (Math.abs(homeScore - awayScore) >= epsilon) {
    return homeScore > awayScore ? homeUserId : awayUserId;
  }

  const tiebreakMode: ReturnType<typeof parseLeagueScoringMode> =
    scoringMode === "percent_gain" ? "dollar_gain" : "percent_gain";
  const [homeTiebreak, awayTiebreak] = await Promise.all([
    computeWeeklyScoreForUser(homeUserId, leagueId, tiebreakMode, options),
    computeWeeklyScoreForUser(awayUserId, leagueId, tiebreakMode, options),
  ]);

  const tiebreakEpsilon = matchupScoreEpsilon(tiebreakMode);
  if (Math.abs(homeTiebreak - awayTiebreak) < tiebreakEpsilon) {
    return null;
  }
  return homeTiebreak > awayTiebreak ? homeUserId : awayUserId;
}

async function scoreSingleMatchup(
  matchup: LeagueMatchupRow,
  scoringMode: ReturnType<typeof parseLeagueScoringMode>,
  options?: {
    forceHybrid?: boolean;
    weekNumber?: number;
    at?: Date;
    supabase?: Awaited<ReturnType<typeof createClient>>;
  }
): Promise<{ error?: string }> {
  if (
    !matchup.home_user_id ||
    !matchup.away_user_id ||
    matchup.status === "complete"
  ) {
    return {};
  }

  const supabase = options?.supabase ?? (await createClient());
  let homeScore: number;
  let awayScore: number;

  try {
    homeScore = await computeWeeklyScoreForUser(
      matchup.home_user_id,
      matchup.league_id,
      scoringMode,
      {
        forceHybrid: options?.forceHybrid,
        weekNumber: options?.weekNumber ?? matchup.week_number,
        at: options?.at,
        supabase: options?.supabase,
      }
    );
    awayScore = await computeWeeklyScoreForUser(
      matchup.away_user_id,
      matchup.league_id,
      scoringMode,
      {
        forceHybrid: options?.forceHybrid,
        weekNumber: options?.weekNumber ?? matchup.week_number,
        at: options?.at,
        supabase: options?.supabase,
      }
    );
  } catch (error) {
    console.error(
      `scoreSingleMatchup failed league=${matchup.league_id} matchup=${matchup.id}:`,
      error
    );
    return { error: SCORING_UNAVAILABLE_MESSAGE };
  }

  const winnerUserId = await resolveMatchupWinner(
    matchup.home_user_id,
    matchup.away_user_id,
    matchup.league_id,
    scoringMode,
    homeScore,
    awayScore,
    { weekNumber: options?.weekNumber ?? matchup.week_number, forceHybrid: options?.forceHybrid, supabase }
  );

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

/**
 * Sets (not increments) each affected user's wins/losses by deriving them
 * from every completed league_matchups row. This function gets called from
 * two independent paths (finalizeMatchupsForLeagueWeek and
 * scoreMatchupForLeague) that can both process the same newly-completed
 * week under normal traffic — a read-increment-write here would double
 * (or triple) count. Deriving from the matchup rows every time makes
 * repeated calls idempotent regardless of how many times/paths trigger it.
 */
async function applyStandingsForCompletedWeek(
  leagueId: string,
  weekNumber: number,
  supabaseOverride?: SupabaseClient
): Promise<void> {
  const supabase = supabaseOverride ?? (await createClient());
  const { data: weekMatchups } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "complete");

  const affectedUserIds = new Set<string>();
  for (const matchup of weekMatchups ?? []) {
    if (matchup.home_user_id) affectedUserIds.add(matchup.home_user_id);
    if (matchup.away_user_id) affectedUserIds.add(matchup.away_user_id);
  }
  if (affectedUserIds.size === 0) return;

  const { data: allCompleted } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id")
    .eq("league_id", leagueId)
    .eq("status", "complete");

  for (const userId of affectedUserIds) {
    let wins = 0;
    let losses = 0;
    for (const m of allCompleted ?? []) {
      if (m.home_user_id !== userId && m.away_user_id !== userId) continue;
      if (m.winner_user_id === userId) wins++;
      else if (m.winner_user_id) losses++;
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

async function advanceLeagueCalendar(
  leagueId: string,
  playerCount: number,
  currentWeek: number,
  supabaseOverride?: SupabaseClient
): Promise<{ seasonComplete?: boolean; nextWeek?: number }> {
  const supabase = supabaseOverride ?? (await createClient());
  const scheduledWeeks = await getScheduledWeekNumbers(leagueId, supabase);
  const { settings } = await loadSeasonCalendarForLeague(leagueId);

  const { data: leagueFormat } = await supabase
    .from("leagues")
    .select("format_type, sports_league_id")
    .eq("id", leagueId)
    .maybeSingle();
  const isSportsSim = isSportsSimLeague({
    formatType: leagueFormat?.format_type,
    sportsLeagueId: leagueFormat?.sports_league_id,
  });

  if (isSportsSim) {
    if (
      isSportsSimRegularSeasonComplete(currentWeek) &&
      !scheduledWeeks.some((week) => week > SDFL_REGULAR_SEASON_WEEKS)
    ) {
      await seedSdflWildCardIfNeeded(supabase, leagueId);
    }

    if (currentWeek === SDFL_WILD_CARD_WEEK) {
      await seedSdflDivisionalIfNeeded(supabase, leagueId);
    }

    if (currentWeek === SDFL_DIVISIONAL_WEEK) {
      await seedSdflConferenceChampionshipIfNeeded(supabase, leagueId);
    }

    if (currentWeek === SDFL_CONFERENCE_CHAMPIONSHIP_WEEK) {
      await seedSdflFinalIfNeeded(supabase, leagueId);
    }
  } else if (settings.rulesApply) {
    const regularSeasonWeeks = settings.regularSeasonWeeks;
    const { semifinalWeek, finalsWeek } = getSdplPlayoffWeeks(regularSeasonWeeks);

    if (
      isSdplRegularSeasonComplete(currentWeek, regularSeasonWeeks) &&
      !scheduledWeeks.some((week) => week > regularSeasonWeeks)
    ) {
      await seedPlayoffsIfNeeded(leagueId, playerCount, {
        sdpl: true,
        semifinalWeek,
      });

      const allocation = await allocatePlayoffBonusPoolIfNeeded(
        leagueId,
        semifinalWeek,
        supabase
      );
      if (allocation.allocationId) {
        await autoClaimPlayoffPayoutsForAllocation(
          supabase,
          leagueId,
          allocation.allocationId
        );
      }
    }

    if (currentWeek === semifinalWeek) {
      await seedPlayoffFinalsIfNeeded(leagueId, semifinalWeek, finalsWeek);
    }
  } else {
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
      await seedLegacyChampionshipIfNeeded(leagueId);
    }
  }

  const refreshedWeeks = await getScheduledWeekNumbers(leagueId, supabase);
  const nextWeek = getNextCalendarWeek(currentWeek, refreshedWeeks);

  if (!nextWeek) {
    await supabase
      .from("leagues")
      .update({ status: "complete" })
      .eq("id", leagueId);
    return { seasonComplete: true };
  }

  await syncLeagueCurrentWeek(leagueId, nextWeek, supabase);
  await captureWeekBaselinesForLeague(leagueId, nextWeek, supabase);
  await setNextWeekFinalizeAt(leagueId, nextWeek, new Date());

  const { data: leagueMeta } = await supabase
    .from("leagues")
    .select("format_type, sports_league_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (
    isSportsSimLeague({
      formatType: leagueMeta?.format_type,
      sportsLeagueId: leagueMeta?.sports_league_id,
    })
  ) {
    await ensureIrSlotsForLeague(supabase, leagueId);
    await runSportsSimIrWeeklyCheck(supabase, leagueId, nextWeek);
  }

  return { seasonComplete: false, nextWeek };
}

async function shouldForceHybridForWeek(
  leagueId: string,
  weekNumber: number,
  supabaseOverride?: SupabaseClient
): Promise<boolean> {
  const { settings } = await loadSeasonCalendarForLeague(leagueId);
  if (!settings.rulesApply || !weekUsesWeekendExtension(settings, weekNumber)) {
    return false;
  }

  const supabase = supabaseOverride ?? (await createClient());
  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("stock_close_captured_at")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .limit(1);

  if (matchups?.[0]?.stock_close_captured_at) return true;

  const { data: drafts } = await supabase
    .from("drafts")
    .select("user_id")
    .eq("league_id", leagueId)
    .limit(1);

  const userId = drafts?.[0]?.user_id;
  if (!userId) return false;

  const baselines = await loadWeekBaselineExtendedMap(
    supabase,
    leagueId,
    userId,
    weekNumber
  );
  return baselinesHaveFridayClose(baselines);
}

export async function finalizeMatchupsForLeagueWeek(
  leagueId: string,
  weekNumber: number,
  at: Date = new Date(),
  supabaseOverride?: Awaited<ReturnType<typeof createClient>>
): Promise<{ finalized?: boolean; error?: string }> {
  const supabase = supabaseOverride ?? (await createClient());

  const { data: league } = await supabase
    .from("leagues")
    .select("status, scoring_mode")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.status !== "active") {
    return { finalized: false };
  }

  const scoringMode = parseLeagueScoringMode(league.scoring_mode);
  const playerCount = await getLeaguePlayerCount(leagueId);

  const { data: weekMatchups } = await supabase
    .from("league_matchups")
    .select("*")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber)
    .eq("status", "scheduled");

  if (!weekMatchups?.length) {
    return { finalized: false };
  }

  const { settings } = await loadSeasonCalendarForLeague(leagueId);
  const sameDayClose = usesSameDayCloseCapture(settings, weekNumber);

  if (sameDayClose) {
    await captureWeekCloseSnapshots(leagueId, weekNumber, supabase);
  }

  const forceHybrid = await shouldForceHybridForWeek(
    leagueId,
    weekNumber,
    supabase
  );
  let lastError: string | undefined;

  for (const matchup of weekMatchups as LeagueMatchupRow[]) {
    const result = await scoreSingleMatchup(matchup, scoringMode, {
      forceHybrid,
      weekNumber,
      at,
      supabase,
    });
    if (result.error) lastError = result.error;
  }

  if (lastError) {
    return { error: lastError, finalized: false };
  }

  if (!sameDayClose) {
    await captureWeekCloseSnapshots(leagueId, weekNumber, supabase);
  }
  await applyStandingsForCompletedWeek(leagueId, weekNumber, supabase);

  const { computeWeeklyAwardsForLeagueWeek } = await import(
    "@/lib/awards/finalize"
  );
  const awardResult = await computeWeeklyAwardsForLeagueWeek(
    leagueId,
    weekNumber
  );
  if (awardResult.errors?.length) {
    console.error(
      `weekly awards league=${leagueId} week=${weekNumber}:`,
      awardResult.errors
    );
  }

  await advanceLeagueCalendar(leagueId, playerCount, weekNumber, supabase);

  return { finalized: true };
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

  const canFinalize = await canFinalizeLeagueWeek(leagueId, currentWeek);
  const { settings } = await loadSeasonCalendarForLeague(leagueId);

  if (settings.rulesApply && !canFinalize) {
    return { scored: false };
  }

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

  const sameDayClose = usesSameDayCloseCapture(settings, currentWeek);

  if (sameDayClose) {
    await captureWeekCloseSnapshots(leagueId, currentWeek, supabase);
  }

  let lastError: string | undefined;
  const forceHybrid = await shouldForceHybridForWeek(leagueId, currentWeek);

  for (const matchup of weekMatchups as LeagueMatchupRow[]) {
    const result = await scoreSingleMatchup(matchup, scoringMode, {
      forceHybrid,
      weekNumber: currentWeek,
    });
    if (result.error) lastError = result.error;
  }

  if (lastError) {
    return { error: lastError, scored: false };
  }

  if (!sameDayClose) {
    await captureWeekCloseSnapshots(leagueId, currentWeek, supabase);
  }
  await applyStandingsForCompletedWeek(leagueId, currentWeek);

  const { computeWeeklyAwardsForLeagueWeek } = await import(
    "@/lib/awards/finalize"
  );
  const awardResult = await computeWeeklyAwardsForLeagueWeek(
    leagueId,
    currentWeek
  );
  if (awardResult.errors?.length) {
    console.error(
      `weekly awards league=${leagueId} week=${currentWeek}:`,
      awardResult.errors
    );
  }

  const cryptoSource = getLastCryptoQuoteSource();
  const notice =
    cryptoSource && cryptoSource !== "live" ? SCORING_DEGRADED_MESSAGE : undefined;

  await advanceLeagueCalendar(leagueId, playerCount, currentWeek);

  return { scored: true, notice };
}

/**
 * Scores active matchups when a user loads a page.
 * - Sports-sim AI leagues: primary driver (scores the current week immediately).
 * - SDPL leagues (AI + human): fallback only — `scoreMatchupForLeague` waits until
 *   `finalize_at` so the Monday cron remains the primary scorer.
 */
export async function scoreActiveMatchupsOnVisit(
  userId: string
): Promise<{ error?: string; notice?: string; scored?: boolean }> {
  const aiLeagues = await listAiLeaguesForUser(userId);
  const { listHumanLeaguesForUser } = await import("@/lib/league/human-league");
  const humanLeagues = await listHumanLeaguesForUser(userId);

  let scoredAny = false;
  let lastError: string | undefined;
  let lastNotice: string | undefined;

  for (const league of aiLeagues) {
    if (league.status !== "active") continue;

    // Sports-sim: scores immediately. SDPL: gated by finalize_at inside scoreMatchupForLeague.
    const result = await scoreMatchupForLeague(userId, league.id);
    if (result.error) lastError = result.error;
    if (result.notice) lastNotice = result.notice;
    if (result.scored) scoredAny = true;
  }

  for (const item of humanLeagues) {
    if (item.league.status !== "active") continue;

    if (
      !isSdplSeasonRulesLeague({
        formatType: item.league.format_type,
        sportsLeagueId: item.league.sports_league_id,
        playerCount: item.league.player_count,
      })
    ) {
      continue;
    }

    const result = await scoreMatchupForLeague(userId, item.league.id);
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

/** @deprecated Use scoreActiveMatchupsOnVisit */
export async function scoreCurrentAiMatchup(
  userId: string
): Promise<{ error?: string; notice?: string; scored?: boolean }> {
  return scoreActiveMatchupsOnVisit(userId);
}

/** @deprecated Use scoreActiveMatchupsOnVisit */
export async function scoreAllActiveAiMatchups(
  userId: string
): Promise<{ error?: string; notice?: string; scored?: boolean }> {
  return scoreActiveMatchupsOnVisit(userId);
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

export async function ensureHumanLeagueReadyForMatchups(
  userId: string
): Promise<{ error?: string }> {
  const { listHumanLeaguesForUser } = await import("@/lib/league/human-league");

  const humanLeagues = await listHumanLeaguesForUser(userId);
  const supabase = await createClient();
  let lastError: string | undefined;

  for (const item of humanLeagues) {
    if (item.league.status === "waiting") continue;

    const readyToSeed =
      item.humanDraftComplete ||
      item.league.status === "active" ||
      item.league.status === "complete";

    if (!readyToSeed) continue;

    const { count } = await supabase
      .from("league_matchups")
      .select("*", { count: "exact", head: true })
      .eq("league_id", item.league.id);

    if (count && count > 0) continue;

    const { seedHumanLeagueRegularSeasonIfMissing } = await import(
      "@/lib/matchup/seed-human-schedule"
    );
    const result = await seedHumanLeagueRegularSeasonIfMissing(
      item.league.id,
      item.league.owner_user_id
    );
    if (result.error) {
      console.error(
        `[ensureHumanLeagueReadyForMatchups] ${item.league.support_code}:`,
        result.error
      );
      lastError = result.error;
    }
  }

  return lastError ? { error: lastError } : {};
}
