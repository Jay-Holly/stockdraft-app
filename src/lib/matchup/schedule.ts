import type { LeaguePlayerCount } from "@/lib/league/league-config";

export const SEASON_FINAL_WEEK = 15;
export const PLAYOFF_START_WEEK = 13;

export type PlayoffRound = "semifinal" | "final";

export type ScheduledGame = {
  weekNumber: number;
  homeUserId: string;
  awayUserId: string;
  isPlayoff: boolean;
  playoffRound?: PlayoffRound;
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

export function normalizePlayerCount(count: number | null | undefined): LeaguePlayerCount {
  const allowed: LeaguePlayerCount[] = [2, 4, 6, 8, 10, 12];
  if (allowed.includes(count as LeaguePlayerCount)) {
    return count as LeaguePlayerCount;
  }
  return 4;
}

/**
 * Round-robin with the first team fixed (commissioner / draft_slot 0).
 * Player-count agnostic for even n ≥ 2: n/2 matchups per week, (n−1) weeks.
 * 4 teams → Week 1: A-B, C-D · Week 2: A-C, B-D · Week 3: A-D, B-C
 * 12 teams → 6 matchups/week × 11 weeks (66 unique pairings).
 */
export function generateRoundRobinPairings(
  teamIds: string[]
): Array<Array<[string, string]>> {
  const n = teamIds.length;
  if (n < 2) return [];

  const schedule: Array<Array<[string, string]>> = [];

  for (let round = 0; round < n - 1; round++) {
    const pairs: Array<[string, string]> = [[teamIds[0], teamIds[round + 1]]];
    const rest = teamIds.filter((_, index) => index !== 0 && index !== round + 1);

    for (let i = 0; i < rest.length / 2; i++) {
      pairs.push([rest[i], rest[rest.length - 1 - i]]);
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
