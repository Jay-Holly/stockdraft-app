import {
  SDPL_FINALS_WEEK,
  SDPL_REGULAR_SEASON_WEEKS,
  SDPL_SEMIFINAL_WEEK,
} from "@/lib/season/constants";
import type { WeekCalendarEntry } from "@/lib/season/types";
import {
  generateRoundRobinPairings,
  type ScheduledGame,
} from "@/lib/matchup/schedule";

/** SDAI-00039 compressed daily-week beta calendar (Jun 29 – Jul 15, 2026). */
export const SDAI_BETA_WEEK_CALENDAR: WeekCalendarEntry[] = [
  { week: 1, date: "2026-06-29" },
  { week: 2, date: "2026-06-30" },
  { week: 3, date: "2026-07-01" },
  { week: 4, date: "2026-07-02" },
  { week: 5, date: "2026-07-03" },
  { week: 6, date: "2026-07-06" },
  { week: 7, date: "2026-07-07" },
  { week: 8, date: "2026-07-08" },
  { week: 9, date: "2026-07-09" },
  { week: 10, date: "2026-07-10" },
  { week: 11, date: "2026-07-13" },
  { week: SDPL_SEMIFINAL_WEEK, date: "2026-07-14" },
  { week: SDPL_FINALS_WEEK, date: "2026-07-15" },
];

/** 11 regular-season weeks cycling round-robin pairings (supports 4–12 teams). */
export function generateBetaDailyRegularSeasonSchedule(
  teamIds: string[],
  regularSeasonWeeks: number = SDPL_REGULAR_SEASON_WEEKS
): ScheduledGame[] {
  const pairings = generateRoundRobinPairings(teamIds);
  if (pairings.length === 0) return [];

  const games: ScheduledGame[] = [];

  for (let week = 1; week <= regularSeasonWeeks; week++) {
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
