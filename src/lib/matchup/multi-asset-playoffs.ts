import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStandingSeeds } from "@/lib/matchup/league-teams";
import { getLeagueMemberDisplayName } from "@/lib/matchup/league-teams";
import { sortStandingsForSeeding, type TeamStandingSeed } from "@/lib/matchup/schedule";
import { computeSportsSimFinalizeAt } from "@/lib/matchup/sdfl-playoffs";
import { genericMapSportForLeague, type GenericMapSport } from "@/lib/league/generic-team-map";
import {
  resolveMlbRealTeamFromSlotKey,
  getMlbDivisionForRealTeam,
} from "@/lib/sim/mlb-team-alignment";
import {
  resolveNbaRealTeamFromSlotKey,
  getNbaDivisionForRealTeam,
} from "@/lib/sim/nba-team-alignment";
import {
  resolveNhlRealTeamFromSlotKey,
  getNhlDivisionForRealTeam,
} from "@/lib/sim/nhl-team-alignment";

/**
 * SDBA/SDHL/SDLB playoff format, simplified from each sport's real postseason
 * to something buildable on this app's existing bracket machinery:
 *  - MLB: 3 division winners + 3 wildcards per league (AL/NL), seeds 1-2
 *    bye the Wild Card round (best-of-3: 3v6, 4v5), Division Series
 *    (best-of-5: 1 vs winner(4v5), 2 vs winner(3v6)), League Championship
 *    Series (best-of-7) crowns each league's champion, World Series
 *    (best-of-7) is AL champ vs NL champ.
 *  - NBA: 3 division winners + 5 wildcards per conference, straight 8-seed
 *    no-bye bracket (1v8, 2v7, 3v6, 4v5), best-of-7 every round including
 *    the Finals (conference champs). Real 2024-25 NBA adds a play-in
 *    tournament for seeds 7-10 — intentionally dropped here.
 *  - NHL: 2 division winners + 6 wildcards per conference (this app's NHL
 *    alignment has 2 divisions/conference, not the real 4-division/
 *    2-conference-of-2-divisions split used for seeding), same 8-seed
 *    no-bye bracket, best-of-7 every round.
 * Series games are NOT tied to any real sim_game_results row (the real
 * 2024/24-25 postseason already happened) — each series game gets its own
 * synthetic game_date (anchor + sequential day), scored by the same
 * single-day % gain engine as the regular season.
 */

type ConferenceKey = string;

type PlayoffFormat = {
  conferenceKeys: readonly ConferenceKey[];
  /** Seeds up to this rank are division winners; the rest are wildcards. */
  winnersPerConference: number;
  fieldSizePerConference: number;
  /** Best-of-N length for each within-conference/league round, in order. */
  roundLengths: readonly number[];
  roundNames: readonly string[];
  finalsRoundName: string;
  finalsBestOf: number;
};

const PLAYOFF_FORMATS: Record<GenericMapSport, PlayoffFormat> = {
  mlb: {
    conferenceKeys: ["al", "nl"],
    winnersPerConference: 3,
    fieldSizePerConference: 6,
    roundLengths: [3, 5, 7],
    roundNames: ["wild_card", "divisional", "conference_championship"],
    finalsRoundName: "final",
    finalsBestOf: 7,
  },
  nba: {
    conferenceKeys: ["east", "west"],
    winnersPerConference: 3,
    fieldSizePerConference: 8,
    roundLengths: [7, 7, 7],
    roundNames: ["wild_card", "divisional", "conference_championship"],
    finalsRoundName: "final",
    finalsBestOf: 7,
  },
  nhl: {
    conferenceKeys: ["east", "west"],
    winnersPerConference: 2,
    fieldSizePerConference: 8,
    roundLengths: [7, 7, 7],
    roundNames: ["wild_card", "divisional", "conference_championship"],
    finalsRoundName: "final",
    finalsBestOf: 7,
  },
};

type DivisionResolver = (realTeam: string) => { conference: string; division: string } | null;
type SlotKeyResolver = (slotKey: string) => string;

const DIVISION_RESOLVERS: Record<GenericMapSport, DivisionResolver> = {
  mlb: getMlbDivisionForRealTeam,
  nba: getNbaDivisionForRealTeam,
  nhl: getNhlDivisionForRealTeam,
};

const SLOT_KEY_RESOLVERS: Record<GenericMapSport, SlotKeyResolver> = {
  mlb: resolveMlbRealTeamFromSlotKey,
  nba: resolveNbaRealTeamFromSlotKey,
  nhl: resolveNhlRealTeamFromSlotKey,
};

type SeededTeam = TeamStandingSeed & { division: string };

async function loadConferenceStandings(
  supabase: SupabaseClient,
  leagueId: string,
  sport: GenericMapSport,
  conferenceKey: ConferenceKey
): Promise<SeededTeam[]> {
  const { data: claimRows, error } = await supabase
    .from("league_map_slot_claims")
    .select("user_id, slot_key")
    .eq("league_id", leagueId);

  if (error) throw new Error(error.message);

  const resolveTeam = SLOT_KEY_RESOLVERS[sport];
  const resolveDivision = DIVISION_RESOLVERS[sport];

  const divisionByUser = new Map<string, string>();
  for (const row of claimRows ?? []) {
    if (!row.user_id || !row.slot_key) continue;
    const realTeam = resolveTeam(row.slot_key);
    const info = resolveDivision(realTeam);
    if (info && info.conference === conferenceKey) {
      divisionByUser.set(row.user_id, info.division);
    }
  }

  const seeds = await loadStandingSeeds(leagueId, supabase);
  return seeds
    .filter((seed) => divisionByUser.has(seed.userId))
    .map((seed) => ({ ...seed, division: divisionByUser.get(seed.userId)! }));
}

/** Division winners ranked first, then wildcards filling the rest of the field. */
export async function computeConferencePlayoffSeeds(
  supabase: SupabaseClient,
  leagueId: string,
  sport: GenericMapSport,
  conferenceKey: ConferenceKey
): Promise<TeamStandingSeed[]> {
  const format = PLAYOFF_FORMATS[sport];
  const standings = await loadConferenceStandings(supabase, leagueId, sport, conferenceKey);

  const divisions = [...new Set(standings.map((team) => team.division))];
  const winners: SeededTeam[] = [];
  const nonWinners: SeededTeam[] = [];

  for (const division of divisions) {
    const teams = standings.filter((team) => team.division === division);
    if (teams.length === 0) continue;
    const [winner, ...rest] = sortStandingsForSeeding(teams) as SeededTeam[];
    winners.push(winner);
    nonWinners.push(...rest);
  }

  const rankedWinners = sortStandingsForSeeding(winners).slice(
    0,
    format.winnersPerConference
  );
  const wildCards = sortStandingsForSeeding(nonWinners).slice(
    0,
    format.fieldSizePerConference - format.winnersPerConference
  );

  return [...rankedWinners, ...wildCards];
}

async function hasRoundMatchups(
  supabase: SupabaseClient,
  leagueId: string,
  playoffRound: string
): Promise<boolean> {
  const { count } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("playoff_round", playoffRound);
  return (count ?? 0) > 0;
}

type SeriesGame = {
  weekNumber: number;
  gameDate: string;
  homeUserId: string;
  awayUserId: string;
  playoffRound: string;
  finalizeAt: string;
};

/** One league_matchups row per series game — bypasses insertScheduledGames since it doesn't support game_date. */
async function insertSeriesGames(
  supabase: SupabaseClient,
  leagueId: string,
  games: SeriesGame[]
): Promise<void> {
  if (games.length === 0) return;
  const rows = await Promise.all(
    games.map(async (game) => {
      const homeName = await getLeagueMemberDisplayName(leagueId, game.homeUserId);
      const awayName = await getLeagueMemberDisplayName(leagueId, game.awayUserId);
      return {
        league_id: leagueId,
        week_number: game.weekNumber,
        game_date: game.gameDate,
        home_user_id: game.homeUserId,
        away_user_id: game.awayUserId,
        is_playoff: true,
        playoff_round: game.playoffRound,
        opponent_bot_id: game.awayUserId,
        opponent_name: `${homeName} vs ${awayName}`,
        status: "scheduled" as const,
        finalize_at: game.finalizeAt,
      };
    })
  );

  const { error } = await supabase.from("league_matchups").insert(rows);
  if (error) throw new Error(error.message);
}

/** Builds one best-of-N series' worth of games for a single pairing. */
function buildSeriesGames(
  weekNumber: number,
  homeUserId: string,
  awayUserId: string,
  playoffRound: string,
  bestOf: number,
  anchor: Date,
  dayOffsetStart: number
): SeriesGame[] {
  const games: SeriesGame[] = [];
  for (let gameIndex = 0; gameIndex < bestOf; gameIndex++) {
    const dayOffset = dayOffsetStart + gameIndex;
    games.push({
      weekNumber,
      gameDate: computeSportsSimFinalizeAt(anchor, dayOffset).slice(0, 10),
      homeUserId,
      awayUserId,
      playoffRound,
      finalizeAt: computeSportsSimFinalizeAt(anchor, dayOffset + 1),
    });
  }
  return games;
}

/** True once one side has won more than half of a best-of-N series' completed games. */
async function loadSeriesWinner(
  supabase: SupabaseClient,
  leagueId: string,
  playoffRound: string,
  homeUserId: string,
  awayUserId: string,
  bestOf: number
): Promise<string | null> {
  const { data } = await supabase
    .from("league_matchups")
    .select("winner_user_id, status")
    .eq("league_id", leagueId)
    .eq("playoff_round", playoffRound)
    .or(
      `and(home_user_id.eq.${homeUserId},away_user_id.eq.${awayUserId}),and(home_user_id.eq.${awayUserId},away_user_id.eq.${homeUserId})`
    );

  const rows = data ?? [];
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  let homeWins = 0;
  let awayWins = 0;
  for (const row of rows) {
    if (row.status !== "complete" || !row.winner_user_id) continue;
    if (row.winner_user_id === homeUserId) homeWins++;
    else if (row.winner_user_id === awayUserId) awayWins++;
  }

  if (homeWins >= winsNeeded) return homeUserId;
  if (awayWins >= winsNeeded) return awayUserId;
  return null;
}

type ConferenceBracketPlan = {
  /** Round-1 pairings, seed numbers (1-based) into the seeded field. */
  round1Pairs: Array<[number, number]>;
  /** Seeds that bye straight to round 2. */
  byeSeeds: number[];
  /** Round-2 pairing rule: for each round-2 game, [byeSeed | null, sourceRound1PairIndex | null pairs]. */
  round2: Array<{ bye?: number; fromPairIndexA?: number; fromPairIndexB?: number }>;
};

function bracketPlanFor(format: PlayoffFormat): ConferenceBracketPlan {
  if (format.fieldSizePerConference === 6) {
    // MLB: seeds 1-2 bye the wild card round.
    return {
      round1Pairs: [
        [3, 6],
        [4, 5],
      ],
      byeSeeds: [1, 2],
      round2: [
        { bye: 1, fromPairIndexB: 1 }, // seed 1 vs winner(4v5)
        { bye: 2, fromPairIndexB: 0 }, // seed 2 vs winner(3v6)
      ],
    };
  }
  // NBA/NHL: straight 8-seed bracket, no byes.
  return {
    round1Pairs: [
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
    ],
    byeSeeds: [],
    round2: [
      { fromPairIndexA: 0, fromPairIndexB: 1 },
      { fromPairIndexA: 2, fromPairIndexB: 3 },
    ],
  };
}

/** The highest week_number among this league's real (non-playoff) regular-season games. */
async function loadRegularSeasonMaxWeek(
  supabase: SupabaseClient,
  leagueId: string
): Promise<number | null> {
  const { data } = await supabase
    .from("league_matchups")
    .select("week_number")
    .eq("league_id", leagueId)
    .eq("is_playoff", false)
    .order("week_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.week_number ?? null;
}

/** Round 1 (Wild Card for MLB, first round for NBA/NHL) — seeds every qualifying conference/league at once. */
export async function seedMultiAssetPlayoffRound1IfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  sportsLeagueId: string | null | undefined,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  const sport = genericMapSportForLeague(sportsLeagueId);
  if (!sport) return { seeded: false };
  const format = PLAYOFF_FORMATS[sport];
  const round = format.roundNames[0];

  if (await hasRoundMatchups(supabase, leagueId, round)) return { seeded: false };

  const regularSeasonMaxWeek = await loadRegularSeasonMaxWeek(supabase, leagueId);
  if (regularSeasonMaxWeek == null) return { seeded: false };
  const weekNumber = regularSeasonMaxWeek + 1;

  const plan = bracketPlanFor(format);
  const bestOf = format.roundLengths[0];
  const games: SeriesGame[] = [];
  let dayOffset = 1;

  for (const conferenceKey of format.conferenceKeys) {
    const seeds = await computeConferencePlayoffSeeds(
      supabase,
      leagueId,
      sport,
      conferenceKey
    );
    if (seeds.length < format.fieldSizePerConference) continue;
    const userIdBySeed = new Map(
      seeds.map((seed, index) => [index + 1, seed.userId])
    );

    for (const [seedA, seedB] of plan.round1Pairs) {
      const homeUserId = userIdBySeed.get(seedA);
      const awayUserId = userIdBySeed.get(seedB);
      if (!homeUserId || !awayUserId) continue;
      games.push(
        ...buildSeriesGames(
          weekNumber,
          homeUserId,
          awayUserId,
          round,
          bestOf,
          now,
          dayOffset
        )
      );
      dayOffset += bestOf;
    }
  }

  if (games.length === 0) return { seeded: false };
  await insertSeriesGames(supabase, leagueId, games);
  return { seeded: true };
}

/**
 * Round 2 (Division Series for MLB, conference semis for NBA/NHL) — needs
 * every round-1 series in every qualifying conference decided first.
 */
export async function seedMultiAssetPlayoffRound2IfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  sportsLeagueId: string | null | undefined,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  const sport = genericMapSportForLeague(sportsLeagueId);
  if (!sport) return { seeded: false };
  const format = PLAYOFF_FORMATS[sport];
  const round1 = format.roundNames[0];
  const round2 = format.roundNames[1];

  if (await hasRoundMatchups(supabase, leagueId, round2)) return { seeded: false };

  const regularSeasonMaxWeek = await loadRegularSeasonMaxWeek(supabase, leagueId);
  if (regularSeasonMaxWeek == null) return { seeded: false };
  const weekNumber = regularSeasonMaxWeek + 2;

  const plan = bracketPlanFor(format);
  const bestOf = format.roundLengths[1];
  const games: SeriesGame[] = [];
  let dayOffset = 1;

  for (const conferenceKey of format.conferenceKeys) {
    const seeds = await computeConferencePlayoffSeeds(
      supabase,
      leagueId,
      sport,
      conferenceKey
    );
    if (seeds.length < format.fieldSizePerConference) continue;
    const userIdBySeed = new Map(
      seeds.map((seed, index) => [index + 1, seed.userId])
    );

    const round1Winners: Array<string | null> = [];
    for (const [seedA, seedB] of plan.round1Pairs) {
      const homeUserId = userIdBySeed.get(seedA);
      const awayUserId = userIdBySeed.get(seedB);
      if (!homeUserId || !awayUserId) {
        round1Winners.push(null);
        continue;
      }
      round1Winners.push(
        await loadSeriesWinner(
          supabase,
          leagueId,
          round1,
          homeUserId,
          awayUserId,
          format.roundLengths[0]
        )
      );
    }
    if (round1Winners.some((winner) => winner === null)) continue;

    for (const pairing of plan.round2) {
      const homeUserId =
        pairing.bye != null
          ? userIdBySeed.get(pairing.bye)
          : pairing.fromPairIndexA != null
            ? round1Winners[pairing.fromPairIndexA]
            : null;
      const awayUserId =
        pairing.fromPairIndexB != null ? round1Winners[pairing.fromPairIndexB] : null;
      if (!homeUserId || !awayUserId) continue;

      games.push(
        ...buildSeriesGames(
          weekNumber,
          homeUserId,
          awayUserId,
          round2,
          bestOf,
          now,
          dayOffset
        )
      );
      dayOffset += bestOf;
    }
  }

  if (games.length === 0) return { seeded: false };
  await insertSeriesGames(supabase, leagueId, games);
  return { seeded: true };
}

/** Round 3 (League Championship Series for MLB, conference finals for NBA/NHL) — one series per qualifying conference/league. */
export async function seedMultiAssetPlayoffRound3IfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  sportsLeagueId: string | null | undefined,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  const sport = genericMapSportForLeague(sportsLeagueId);
  if (!sport) return { seeded: false };
  const format = PLAYOFF_FORMATS[sport];
  const round2 = format.roundNames[1];
  const round3 = format.roundNames[2];

  if (await hasRoundMatchups(supabase, leagueId, round3)) return { seeded: false };

  const { data: round2Rows } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id, status, week_number")
    .eq("league_id", leagueId)
    .eq("playoff_round", round2);

  const pairKey = (a: string, b: string) => [a, b].sort().join(":");
  const winnerByPair = new Map<string, string>();
  for (const row of round2Rows ?? []) {
    if (!row.home_user_id || !row.away_user_id || !row.winner_user_id) continue;
    winnerByPair.set(pairKey(row.home_user_id, row.away_user_id), row.winner_user_id);
  }

  const regularSeasonMaxWeek = await loadRegularSeasonMaxWeek(supabase, leagueId);
  if (regularSeasonMaxWeek == null) return { seeded: false };
  const weekNumber = regularSeasonMaxWeek + 3;

  const bestOf = format.roundLengths[2];
  const games: SeriesGame[] = [];
  let dayOffset = 1;

  for (const conferenceKey of format.conferenceKeys) {
    // Round 2 always produces exactly 2 series per qualifying conference —
    // both must be decided before this conference's round 3 can seed.
    const pairs = new Set(
      (round2Rows ?? [])
        .filter((row) => row.home_user_id && row.away_user_id)
        .map((row) => pairKey(row.home_user_id!, row.away_user_id!))
    );
    const conferenceWinners: string[] = [];
    for (const key of pairs) {
      const winner = winnerByPair.get(key);
      if (winner) conferenceWinners.push(winner);
    }
    // This loop runs once per conference but `pairs`/`conferenceWinners`
    // above are computed league-wide — narrow to the 2 winners that belong
    // to this conference by re-deriving the seeded field.
    const seeds = await computeConferencePlayoffSeeds(
      supabase,
      leagueId,
      sport,
      conferenceKey
    );
    const seedUserIds = new Set(seeds.map((seed) => seed.userId));
    const thisConferenceWinners = conferenceWinners.filter((id) =>
      seedUserIds.has(id)
    );
    if (thisConferenceWinners.length !== 2) continue;

    const [homeUserId, awayUserId] = thisConferenceWinners;
    games.push(
      ...buildSeriesGames(weekNumber, homeUserId, awayUserId, round3, bestOf, now, dayOffset)
    );
    dayOffset += bestOf;
  }

  if (games.length === 0) return { seeded: false };
  await insertSeriesGames(supabase, leagueId, games);
  return { seeded: true };
}

/** Finals (World Series for MLB, Finals for NBA/NHL) — the two round-3 winners. */
export async function seedMultiAssetPlayoffFinalsIfNeeded(
  supabase: SupabaseClient,
  leagueId: string,
  sportsLeagueId: string | null | undefined,
  now: Date = new Date()
): Promise<{ seeded: boolean }> {
  const sport = genericMapSportForLeague(sportsLeagueId);
  if (!sport) return { seeded: false };
  const format = PLAYOFF_FORMATS[sport];
  const round3 = format.roundNames[2];

  if (await hasRoundMatchups(supabase, leagueId, format.finalsRoundName)) {
    return { seeded: false };
  }

  const { data: round3Rows } = await supabase
    .from("league_matchups")
    .select("home_user_id, away_user_id, winner_user_id, status")
    .eq("league_id", leagueId)
    .eq("playoff_round", round3);

  const complete = (round3Rows ?? []).filter(
    (row) => row.status === "complete" && row.home_user_id && row.away_user_id
  );
  if (complete.length < format.conferenceKeys.length) return { seeded: false };

  const winnersByPair = new Map<string, string>();
  for (const row of complete) {
    if (!row.winner_user_id) return { seeded: false };
    winnersByPair.set(`${row.home_user_id}:${row.away_user_id}`, row.winner_user_id);
  }
  const winners = [...new Set(winnersByPair.values())];
  if (winners.length !== 2) return { seeded: false };

  const regularSeasonMaxWeek = await loadRegularSeasonMaxWeek(supabase, leagueId);
  if (regularSeasonMaxWeek == null) return { seeded: false };
  const weekNumber = regularSeasonMaxWeek + 4;

  const games = buildSeriesGames(
    weekNumber,
    winners[0],
    winners[1],
    format.finalsRoundName,
    format.finalsBestOf,
    now,
    1
  );

  await insertSeriesGames(supabase, leagueId, games);
  return { seeded: true };
}

/** Regular season is "complete" once every real scheduled game for this league has a completed status. */
export async function isMultiAssetRegularSeasonComplete(
  supabase: SupabaseClient,
  leagueId: string
): Promise<boolean> {
  const { count: scheduledCount } = await supabase
    .from("league_matchups")
    .select("*", { count: "exact", head: true })
    .eq("league_id", leagueId)
    .eq("is_playoff", false)
    .eq("status", "scheduled");
  return (scheduledCount ?? 0) === 0;
}
