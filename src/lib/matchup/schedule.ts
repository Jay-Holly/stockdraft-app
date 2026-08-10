import type { LeaguePlayerCount } from "@/lib/league/league-config";
import {
  SDPL_FINALS_WEEK,
  SDPL_REGULAR_SEASON_WEEKS,
  SDPL_SEMIFINAL_WEEK,
} from "@/lib/season/constants";

export const SEASON_FINAL_WEEK = 15;
export const PLAYOFF_START_WEEK = 13;

export type PlayoffRound =
  | "semifinal"
  | "final"
  | "third_place"
  | "wild_card"
  | "divisional"
  | "conference_championship";

export { SDPL_FINALS_WEEK, SDPL_REGULAR_SEASON_WEEKS, SDPL_SEMIFINAL_WEEK };

export type ScheduledGame = {
  weekNumber: number;
  homeUserId: string;
  awayUserId: string;
  isPlayoff: boolean;
  playoffRound?: PlayoffRound;
  /** Sports-sim only: explicit finalize timestamp for day-compressed pacing. */
  finalizeAt?: string;
};

export type TeamStandingSeed = {
  userId: string;
  wins: number;
  losses: number;
  seasonGainPercent: number;
};

/** Regular-season round-robin weeks = playerCount - 1. */
export function getRegularSeasonWeeks(playerCount: number): number {
  return Math.max(playerCount - 1, 1);
}

export function usesTwoTeamPlayoff(playerCount: number): boolean {
  return playerCount === 4 || playerCount === 6;
}

export function usesFourTeamPlayoff(playerCount: number): boolean {
  return playerCount === 8 || playerCount === 10 || playerCount === 12;
}

/** SDPL leagues always use a top-4 bracket (semis → final + 3rd place). */
export function usesSdplPlayoffBracket(_playerCount: number): boolean {
  return true;
}

export function isSdplRegularSeasonComplete(
  currentWeek: number,
  regularSeasonWeeks: number = SDPL_REGULAR_SEASON_WEEKS
): boolean {
  return currentWeek >= regularSeasonWeeks;
}

export function formatPlayoffRoundLabel(
  round: string | null | undefined
): string {
  if (round === "final") return "Championship";
  if (round === "third_place") return "3rd Place";
  if (round === "semifinal") return "Semifinal";
  if (round === "wild_card") return "Wild Card";
  if (round === "divisional") return "Divisional";
  if (round === "conference_championship") return "Conference Championship";
  return "";
}

export function normalizePlayerCount(count: number | null | undefined): LeaguePlayerCount {
  const allowed: LeaguePlayerCount[] = [4, 6, 8, 10, 12];
  if (allowed.includes(count as LeaguePlayerCount)) {
    return count as LeaguePlayerCount;
  }
  return 4;
}

/**
 * Round-robin (circle method) with the first team fixed (commissioner /
 * draft_slot 0) and every other team rotating around it.
 * Player-count agnostic for n ≥ 2: ⌊n/2⌋ matchups per week, (n−1) weeks,
 * and every pair of teams meets exactly once across those weeks.
 * 4 teams → Week 1: A-B, C-D · Week 2: A-D, B-C · Week 3: A-C, D-B
 * 12 teams → 6 matchups/week × 11 weeks (66 unique pairings).
 *
 * Odd n gets a bye: one team sits out each week and (n−1) weeks still
 * covers every pairing.
 */
export function generateRoundRobinPairings(
  teamIds: string[]
): Array<Array<[string, string]>> {
  if (teamIds.length < 2) return [];

  // Odd counts need a placeholder so the circle has an even circumference;
  // whoever draws it that week has the bye and simply isn't scheduled.
  const BYE = "__bye__";
  const teams = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE];

  const fixed = teams[0];
  const rotating = teams.slice(1);
  const m = rotating.length;

  const schedule: Array<Array<[string, string]>> = [];

  for (let round = 0; round < m; round++) {
    // Rotate the ring one seat per round. Rotating (rather than dropping one
    // team out of a static list) is what makes every pairing unique — the
    // previous implementation re-paired the remaining teams from an unrotated
    // list, so the same opponents were matched week after week.
    const ring = rotating.map(
      (_, index) => rotating[(index + round) % m]
    );

    const pairs: Array<[string, string]> = [];
    if (fixed !== BYE && ring[0] !== BYE) pairs.push([fixed, ring[0]]);

    for (let i = 1; i <= (m - 1) / 2; i++) {
      const home = ring[i];
      const away = ring[m - i];
      if (home !== BYE && away !== BYE) pairs.push([home, away]);
    }

    schedule.push(pairs);
  }

  return schedule;
}

export function generateRegularSeasonSchedule(
  teamIds: string[]
): ScheduledGame[] {
  const pairings = generateRoundRobinPairings(teamIds);
  const games: ScheduledGame[] = [];

  for (let weekIndex = 0; weekIndex < pairings.length; weekIndex++) {
    for (const [homeUserId, awayUserId] of pairings[weekIndex]) {
      games.push({
        weekNumber: weekIndex + 1,
        homeUserId,
        awayUserId,
        isPlayoff: false,
      });
    }
  }

  return games;
}

/**
 * SDPL regular season: cycle round-robin slates until `totalWeeks` (default 11).
 * 4 teams → 3 unique slates repeat; 12 teams → 11 unique slates (no repeat).
 */
export function generateCyclingRegularSeasonSchedule(
  teamIds: string[],
  totalWeeks: number = SDPL_REGULAR_SEASON_WEEKS
): ScheduledGame[] {
  const pairings = generateRoundRobinPairings(teamIds);
  if (pairings.length === 0 || totalWeeks < 1) return [];

  const games: ScheduledGame[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const weekPairings = pairings[(week - 1) % pairings.length];
    for (const [homeUserId, awayUserId] of weekPairings) {
      games.push({
        weekNumber: week,
        homeUserId,
        awayUserId,
        isPlayoff: false,
      });
    }
  }

  return games;
}

/** Playoff weeks derived from regular season length (SDPL: 12 semis, 13 finals when reg=11). */
export function getSdplPlayoffWeeks(regularSeasonWeeks: number): {
  semifinalWeek: number;
  finalsWeek: number;
} {
  return {
    semifinalWeek: regularSeasonWeeks + 1,
    finalsWeek: regularSeasonWeeks + 2,
  };
}

/** True when existing regular-season weeks include stale numbers beyond the configured length. */
export function sdplScheduleNeedsReseed(
  regularWeekNumbers: number[],
  regularSeasonWeeks: number
): boolean {
  if (regularWeekNumbers.length === 0) return true;
  return regularWeekNumbers.some((week) => week > regularSeasonWeeks);
}

export function missingSdplRegularSeasonWeeks(
  regularWeekNumbers: number[],
  regularSeasonWeeks: number
): number[] {
  const missing: number[] = [];
  for (let week = 1; week <= regularSeasonWeeks; week++) {
    if (!regularWeekNumbers.includes(week)) missing.push(week);
  }
  return missing;
}

export function buildTwoTeamChampionship(
  weekNumber: number,
  teamA: string,
  teamB: string
): ScheduledGame {
  return {
    weekNumber,
    homeUserId: teamA,
    awayUserId: teamB,
    isPlayoff: true,
    playoffRound: "final",
  };
}

export function buildFourTeamSemifinals(
  weekNumber: number,
  seeds: [string, string, string, string]
): ScheduledGame[] {
  const [s1, s2, s3, s4] = seeds;
  return [
    {
      weekNumber,
      homeUserId: s1,
      awayUserId: s4,
      isPlayoff: true,
      playoffRound: "semifinal",
    },
    {
      weekNumber,
      homeUserId: s2,
      awayUserId: s3,
      isPlayoff: true,
      playoffRound: "semifinal",
    },
  ];
}

export function buildChampionshipFromWinners(
  weekNumber: number,
  winnerA: string,
  winnerB: string
): ScheduledGame {
  return buildTwoTeamChampionship(weekNumber, winnerA, winnerB);
}

export function buildThirdPlaceGame(
  weekNumber: number,
  loserA: string,
  loserB: string
): ScheduledGame {
  return {
    weekNumber,
    homeUserId: loserA,
    awayUserId: loserB,
    isPlayoff: true,
    playoffRound: "third_place",
  };
}

/** Championship (semifinal winners) + 3rd-place game (semifinal losers), same week. */
export function buildPlayoffFinalsWeek(
  weekNumber: number,
  semifinalWinners: [string, string],
  semifinalLosers: [string, string]
): ScheduledGame[] {
  return [
    buildChampionshipFromWinners(
      weekNumber,
      semifinalWinners[0],
      semifinalWinners[1]
    ),
    buildThirdPlaceGame(
      weekNumber,
      semifinalLosers[0],
      semifinalLosers[1]
    ),
  ];
}

export function partitionSemifinalResults(
  semis: Array<{
    home_user_id: string | null;
    away_user_id: string | null;
    winner_user_id: string | null;
  }>
): { winners: [string, string]; losers: [string, string] } | null {
  if (semis.length < 2) return null;

  const winners: string[] = [];
  const losers: string[] = [];

  for (const row of semis) {
    if (!row.home_user_id || !row.away_user_id || !row.winner_user_id) {
      return null;
    }
    winners.push(row.winner_user_id);
    losers.push(
      row.winner_user_id === row.home_user_id
        ? row.away_user_id
        : row.home_user_id
    );
  }

  if (winners.length !== 2 || losers.length !== 2) return null;
  return {
    winners: [winners[0], winners[1]],
    losers: [losers[0], losers[1]],
  };
}

export function sortStandingsForSeeding(
  rows: TeamStandingSeed[]
): TeamStandingSeed[] {
  return [...rows].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.seasonGainPercent - a.seasonGainPercent;
  });
}

export function getNextCalendarWeek(
  currentWeek: number,
  scheduledWeeks: number[]
): number | null {
  const sorted = [...new Set(scheduledWeeks)].sort((a, b) => a - b);
  for (const week of sorted) {
    if (week > currentWeek) return week;
  }
  return null;
}

export function isRegularSeasonComplete(
  currentWeek: number,
  playerCount: number
): boolean {
  return currentWeek >= getRegularSeasonWeeks(playerCount);
}
