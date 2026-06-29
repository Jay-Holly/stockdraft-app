import type { LeagueFormatType } from "@/lib/league/league-config";

export type LeagueSupportCodeInput = {
  leagueType: string;
  formatType: LeagueFormatType | string;
  sportsLeagueId?: string | null;
  playerCount?: number | null;
};

/**
 * Expected support_code prefix (before numeric suffix).
 * Matches public.league_support_code_prefix() — migration 042.
 *
 * Check order:
 *   1. league_type = 'ai' → SDAI
 *   2. sports_league format → SDFL / SDHL / SDBA / SDLB
 *   3. standard human player-count league → SDPL{n}
 *   4. solo / legacy fallback → SDPL4
 */
export function expectedLeagueSupportCodePrefix(
  input: LeagueSupportCodeInput
): string {
  if (input.leagueType === "ai") {
    return "SDAI";
  }

  if (input.formatType === "sports_league" && input.sportsLeagueId) {
    return input.sportsLeagueId.toUpperCase();
  }

  if (
    input.formatType === "standard" &&
    [2, 4, 6, 8, 10, 12].includes(input.playerCount ?? 0)
  ) {
    return `SDPL${input.playerCount}`;
  }

  return "SDPL4";
}
