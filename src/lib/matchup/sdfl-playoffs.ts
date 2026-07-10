import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStandingSeeds } from "@/lib/matchup/league-teams";
import {
  sortStandingsForSeeding,
  type ScheduledGame,
  type TeamStandingSeed,
} from "@/lib/matchup/schedule";
import { insertScheduledGames } from "@/lib/matchup/scoring";
import {
  SDFL_CONFERENCE_CHAMPIONSHIP_WEEK,
  SDFL_DIVISIONAL_WEEK,
  SDFL_FINAL_WEEK,
  SDFL_REGULAR_SEASON_WEEKS,
  SDFL_WILD_CARD_WEEK,
} from "@/lib/matchup/sdfl-schedule";
import type {
  SdflConference,
  SdflDivision,
} from "@/lib/league/sdfl-divisions";

/**
 * SDFL day-pacing is a parallel, SDFL-only mechanism — finalize_at is
 * written directly onto each league_matchups row rather than going through
 * league_season_settings/isSdplSeasonRulesLeague, which also carries
 * lineup-lock and free-agency-window rules SDFL has never had. Each round
 * finalizes exactly 1 day after it's created; simple 24h multiples, not
 * aligned to any ET wall-clock boundary.
 */
export function computeSportsSimFinalizeAt(anchor: Date, dayOffset: number): string {
  return new Date(anchor.getTime() + dayOffset * 24 * 60 * 60 * 1000).toISOString();
}

export function isSportsSimRegularSeasonComplete(currentWeek: number): boolean {
  return currentWeek >= SDFL_REGULAR_SEASON_WEEKS;
}

type IdentityRow = {
  user_id: string;
  conference: SdflConference | null;
  division: SdflDivision | null;
};

type SeededTeam = TeamStandingSeed & { division: SdflDivision };

async function loadConferenceStandings(
  supabase: SupabaseClient,
  leagueId: string,
  conference: SdflConference
): Promise<SeededTeam[]> {
  const { data: identityRows, error } = await supabase
    .from("league_members")
    .select("user_id, conference, division")
    .eq("league_id", leagueId)
    .eq("conference", conference);

  if (error) throw new Error(error.message);

  const divisionByUser = new Map<string, SdflDivision>();
  for (const row of (identityRows ?? []) as IdentityRow[]) {
    if (row.division) divisionByUser.set(row.user_id, row.division);
  }

  const seeds = await loadStandingSeeds(leagueId, supabase);
  return seeds
    .filter((seed) => divisionByUser.has(seed.userId))
    .map((seed) => ({ ...seed, division: divisionByUser.get(seed.userId)! }));
}

/** 4 division winners (seeds 1-4, ranked) + 3 wild cards (seeds 5-7, ranked). */
export async function computeConferencePlayoffSeeds(
  supabase: SupabaseClient,
  leagueId: string,
  conference: SdflConference
): Promise<TeamStandingSeed[]> {
  const standings = await loadConferenceStandings(supabase, leagueId, conference);

  const divisions: SdflDivision[] = ["north", "south", "east", "west"];
  const winners: SeededTeam[] = [];
  const nonWinners: SeededTeam[] = [];

  for (const division of divisions) {
    const teams = standings.filter((team) => team.division === division);
    if (teams.length === 0) continue;
    const [winner, ...rest] = sortStandingsForSeeding(teams) as SeededTeam[];
    winners.push(winner);
    nonWinners.push(...rest);
  }

  const rankedWinners = sortStandingsForSeeding(winners);
  const wildCards = sortStandingsForSeeding(nonWinners).slice(0, 3);

  return [...rankedWinners, ...wildCards];
}

async function hasWeekMatchups(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<boolean> {
  const { count } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);
  return (count ?? 0) > 0;
}

type CompletedResultRow = {
  home_user_id: string;
  away_user_id: string;
  winner_user_id: string | null;
};

async function loadWeekResults(
  supabase: SupabaseClient,
  leagueId: string,
  weekNumber: number
): Promise<CompletedResultRow[]> {
  const { data } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id, status")
    .eq("league_id", leagueId)
    .eq("week_number", weekNumber);

  return (data ?? [])
    .filter((row) => row.status === "complete" && row.home_user_id && row.away_user_id)
    .map((row) => ({
      home_user_id: row.home_user_id as string,
      away_user_id: row.away_user_id as string,
      winner_user_id: row.winner_user_id,
    }));
}

function winnerOf(
  results: CompletedResultRow[],
  teamA: string,
  teamB: string
): string | null {
  const game = results.find(
    (row) =>
      (row.home_user_id === teamA && row.away_user_id === teamB) ||
      (row.home_user_id === teamB && row.away_user_id === teamA)
  );
  if (!game) return null;
  return game.winner_user_id ?? game.home_user_id;
}

/** Wild Card round: (1) byes, (2v7), (3v6), (4v5) per conference. */
export async function seedSdflWildCardIfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  if (await hasWeekMatchups(supabase, leagueId, SDFL_WILD_CARD_WEEK)) {
    return { seeded: false };
  }

  const finalizeAt = computeSportsSimFinalizeAt(now, 1);
  const games: ScheduledGame[] = [];

  for (const conference of ["sdal", "sdnl"] as SdflConference[]) {
    const seeds = await computeConferencePlayoffSeeds(supabase, leagueId, conference);
    if (seeds.length < 7) continue;
    const [, s2, s3, s4, s5, s6, s7] = seeds.map((seed) => seed.userId);

    games.push(
      {
        weekNumber: SDFL_WILD_CARD_WEEK,
        homeUserId: s2,
        awayUserId: s7,
        isPlayoff: true,
        playoffRound: "wild_card",
        finalizeAt,
      },
      {
        weekNumber: SDFL_WILD_CARD_WEEK,
        homeUserId: s3,
        awayUserId: s6,
        isPlayoff: true,
        playoffRound: "wild_card",
        finalizeAt,
      },
      {
        weekNumber: SDFL_WILD_CARD_WEEK,
        homeUserId: s4,
        awayUserId: s5,
        isPlayoff: true,
        playoffRound: "wild_card",
        finalizeAt,
      }
    );
  }

  if (games.length === 0) return { seeded: false };
  const result = await insertScheduledGames(leagueId, games, null, supabase);
  if (result.error) throw new Error(result.error);
  return { seeded: true };
}

/** Divisional round: (1) vs winner of (4v5); winner of (2v7) vs winner of (3v6). */
export async function seedSdflDivisionalIfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  if (await hasWeekMatchups(supabase, leagueId, SDFL_DIVISIONAL_WEEK)) {
    return { seeded: false };
  }

  const results = await loadWeekResults(supabase, leagueId, SDFL_WILD_CARD_WEEK);
  if (results.length < 3) return { seeded: false };

  const finalizeAt = computeSportsSimFinalizeAt(now, 1);
  const games: ScheduledGame[] = [];

  for (const conference of ["sdal", "sdnl"] as SdflConference[]) {
    const seeds = await computeConferencePlayoffSeeds(supabase, leagueId, conference);
    if (seeds.length < 7) continue;
    const [s1, s2, s3, s4, s5, s6, s7] = seeds.map((seed) => seed.userId);

    const winner4v5 = winnerOf(results, s4, s5);
    const winner2v7 = winnerOf(results, s2, s7);
    const winner3v6 = winnerOf(results, s3, s6);
    if (!winner4v5 || !winner2v7 || !winner3v6) continue;

    games.push(
      {
        weekNumber: SDFL_DIVISIONAL_WEEK,
        homeUserId: s1,
        awayUserId: winner4v5,
        isPlayoff: true,
        playoffRound: "divisional",
        finalizeAt,
      },
      {
        weekNumber: SDFL_DIVISIONAL_WEEK,
        homeUserId: winner2v7,
        awayUserId: winner3v6,
        isPlayoff: true,
        playoffRound: "divisional",
        finalizeAt,
      }
    );
  }

  if (games.length === 0) return { seeded: false };
  const result = await insertScheduledGames(leagueId, games, null, supabase);
  if (result.error) throw new Error(result.error);
  return { seeded: true };
}

/** Conference Championship: the two Divisional Round winners per conference. */
export async function seedSdflConferenceChampionshipIfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  if (await hasWeekMatchups(supabase, leagueId, SDFL_CONFERENCE_CHAMPIONSHIP_WEEK)) {
    return { seeded: false };
  }

  const { data: divisionalRows } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id, status")
    .eq("league_id", leagueId)
    .eq("week_number", SDFL_DIVISIONAL_WEEK);

  const complete = (divisionalRows ?? []).filter(
    (row) => row.status === "complete" && row.home_user_id && row.away_user_id
  );
  if (complete.length < 2) return { seeded: false };

  const finalizeAt = computeSportsSimFinalizeAt(now, 1);
  const games: ScheduledGame[] = [];

  // Divisional rows are inserted two-per-conference in seedSdflDivisionalIfNeeded;
  // pair them up in insertion order (first two = one conference, next two = other).
  for (let i = 0; i + 1 < complete.length; i += 2) {
    const gameA = complete[i];
    const gameB = complete[i + 1];
    const winnerA = gameA.winner_user_id ?? gameA.home_user_id;
    const winnerB = gameB.winner_user_id ?? gameB.home_user_id;
    if (!winnerA || !winnerB) continue;

    games.push({
      weekNumber: SDFL_CONFERENCE_CHAMPIONSHIP_WEEK,
      homeUserId: winnerA,
      awayUserId: winnerB,
      isPlayoff: true,
      playoffRound: "conference_championship",
      finalizeAt,
    });
  }

  if (games.length === 0) return { seeded: false };
  const result = await insertScheduledGames(leagueId, games, null, supabase);
  if (result.error) throw new Error(result.error);
  return { seeded: true };
}

/** Stock Draft Bowl: the two Conference Champions. */
export async function seedSdflFinalIfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  if (await hasWeekMatchups(supabase, leagueId, SDFL_FINAL_WEEK)) {
    return { seeded: false };
  }

  const { data: champRows } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id, status")
    .eq("league_id", leagueId)
    .eq("week_number", SDFL_CONFERENCE_CHAMPIONSHIP_WEEK);

  const complete = (champRows ?? []).filter(
    (row) => row.status === "complete" && row.home_user_id && row.away_user_id
  );
  if (complete.length < 2) return { seeded: false };

  const [gameA, gameB] = complete;
  const winnerA = gameA.winner_user_id ?? gameA.home_user_id;
  const winnerB = gameB.winner_user_id ?? gameB.home_user_id;
  if (!winnerA || !winnerB) return { seeded: false };

  const finalizeAt = computeSportsSimFinalizeAt(now, 1);
  const result = await insertScheduledGames(
    leagueId,
    [
      {
        weekNumber: SDFL_FINAL_WEEK,
        homeUserId: winnerA,
        awayUserId: winnerB,
        isPlayoff: true,
        playoffRound: "final",
        finalizeAt,
      },
    ],
    null,
    supabase
  );
  if (result.error) throw new Error(result.error);
  return { seeded: true };
}
