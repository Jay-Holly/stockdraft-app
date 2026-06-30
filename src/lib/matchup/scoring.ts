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
import {
  canFinalizeLeagueWeek,
  setNextWeekFinalizeAt,
} from "@/lib/matchup/finalize-week";
import { loadSeasonCalendarForLeague } from "@/lib/season/settings-server";
import { isSdplSeasonRulesLeague } from "@/lib/season/sdpl-league";
import { SDPL_REGULAR_SEASON_WEEKS } from "@/lib/season/constants";
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
  weekNumber: number,
  supabaseOverride?: SupabaseClient
): Promise<void> {
  const supabase = supabaseOverride ?? (await createClient());
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
  currentWeek: number,
  supabaseOverride?: SupabaseClient
): Promise<{ seasonComplete?: boolean; nextWeek?: number }> {
  const supabase = supabaseOverride ?? (await createClient());
  const scheduledWeeks = await getScheduledWeekNumbers(leagueId, supabase);
  const { settings } = await loadSeasonCalendarForLeague(leagueId);

  if (settings.rulesApply) {
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
