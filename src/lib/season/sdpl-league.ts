import type { LeagueFormatMeta } from "@/lib/season/types";

/** SDPL player-count leagues that use the 13-week calendar, lock, and FA rules. */
export const SDPL_PLAYER_COUNTS = [4, 6, 8, 10, 12] as const;

export type SdplPlayerCount = (typeof SDPL_PLAYER_COUNTS)[number];

export const SPORTS_SIM_LEAGUE_IDS = ["sdfl", "sdhl", "sdba", "sdlb"] as const;

export function isSportsSimLeague(league: LeagueFormatMeta): boolean {
  if (league.formatType === "sports_league") return true;
  const id = league.sportsLeagueId?.toLowerCase();
  return !!id && (SPORTS_SIM_LEAGUE_IDS as readonly string[]).includes(id);
}

/**
 * True for SDPL-format leagues (4/6/8/10/12 players, standard format).
 * False for SDFL/SDHL/SDBA/SDLB sports-sim leagues — those keep legacy behavior.
 */
export function isSdplSeasonRulesLeague(league: LeagueFormatMeta): boolean {
  if (isSportsSimLeague(league)) return false;
  const count = league.playerCount ?? 0;
  return (SDPL_PLAYER_COUNTS as readonly number[]).includes(count);
}

export function normalizeSdplPlayerCount(
  count: number | null | undefined
): SdplPlayerCount | null {
  if (count == null) return null;
  return (SDPL_PLAYER_COUNTS as readonly number[]).includes(count)
    ? (count as SdplPlayerCount)
    : null;
}
