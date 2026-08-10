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

/**
 * Leagues that enforce the daily lineup lock and the Friday 4:00 PM → Monday
 * 9:30 AM free agency window: SDPL/SDAI plus SDFL.
 *
 * Deliberately separate from isSdplSeasonRulesLeague, which additionally
 * drives season length, week finalization timing, score capture, awards and
 * playoff seeding. SDFL keeps its own 18-week schedule and 4-round
 * postseason, so it must get the move gates without inheriting any of that.
 * SDBA/SDHL/SDLB stay ungated until their calendars are built.
 */
export function enforcesStandardMoveGates(league: LeagueFormatMeta): boolean {
  if (isSdplSeasonRulesLeague(league)) return true;
  return league.sportsLeagueId?.toLowerCase() === "sdfl";
}

export function normalizeSdplPlayerCount(
  count: number | null | undefined
): SdplPlayerCount | null {
  if (count == null) return null;
  return (SDPL_PLAYER_COUNTS as readonly number[]).includes(count)
    ? (count as SdplPlayerCount)
    : null;
}

/**
 * SDBA/SDHL/SDLB — multi-game-per-week sports-sim leagues that use their own
 * roster/move rules (open anytime-FA, sector-locked stock swaps, stock moves
 * gated to outside market hours, IR as a free stash slot). SDFL keeps the
 * original one-game-per-week sports-sim behavior and is deliberately
 * excluded here.
 */
export const MULTI_ASSET_SIM_LEAGUE_IDS = ["sdba", "sdhl", "sdlb"] as const;

export function isMultiAssetSimLeague(
  sportsLeagueId: string | null | undefined
): boolean {
  const id = sportsLeagueId?.toLowerCase();
  return !!id && (MULTI_ASSET_SIM_LEAGUE_IDS as readonly string[]).includes(id);
}
