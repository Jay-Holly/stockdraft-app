import type { LeagueScoringMode } from "@/lib/league/scoring-mode";
import type { DraftOrderMethodSetting } from "@/lib/league/draft-order";

export type LeagueFormatType = "standard" | "sports_league";
export type LeagueVisibility = "private" | "public";
export type LeagueOpponentType = "all_ai" | "all_human" | "mixed";
export type LeaguePlayerCount = 2 | 4 | 6 | 8 | 10 | 12 | 30 | 32;
export type { LeagueScoringMode };

export const STANDARD_PLAYER_COUNTS: LeaguePlayerCount[] = [
  2, 4, 6, 8, 10, 12,
];

export const SPORTS_LEAGUE_PLAYER_COUNTS: LeaguePlayerCount[] = [30, 32];

export const SPORTS_LEAGUE_FORMATS = [
  { id: "sdfl", label: "SDFL", description: "StockDraft Football League" },
  { id: "sdhl", label: "SDHL", description: "StockDraft Hockey League" },
  { id: "sdba", label: "SDBA", description: "StockDraft Basketball Association" },
  { id: "sdlb", label: "SDLB", description: "StockDraft League Baseball" },
] as const;

export type CreateLeagueConfig = {
  formatType: LeagueFormatType;
  sportsLeagueId?: string;
  playerCount: LeaguePlayerCount;
  visibility: LeagueVisibility;
  opponentType: LeagueOpponentType;
  scoringMode: LeagueScoringMode;
  leagueName: string;
  teamName: string;
  inviteEmail?: string;
  /** ISO 8601 — draft starts at this time; empty slots filled with bots if applicable. */
  scheduledDraftAt?: string | null;
  /** Standard leagues only — how live draft pick order is generated. */
  draftOrderMethod?: DraftOrderMethodSetting;
};

export function playerCountsForFormat(
  formatType: LeagueFormatType
): LeaguePlayerCount[] {
  return formatType === "sports_league"
    ? SPORTS_LEAGUE_PLAYER_COUNTS
    : STANDARD_PLAYER_COUNTS;
}

export function requiresScheduledDraft(config: CreateLeagueConfig): boolean {
  return (
    config.visibility === "public" ||
    config.opponentType !== "all_human" ||
    config.playerCount > 2
  );
}

export function isHumanLeagueSupported(config: CreateLeagueConfig): boolean {
  const allowedCounts = playerCountsForFormat(config.formatType);
  if (!allowedCounts.includes(config.playerCount)) return false;

  if (config.formatType === "sports_league") {
    if (!config.sportsLeagueId) return false;
    if (!SPORTS_LEAGUE_FORMATS.some((format) => format.id === config.sportsLeagueId)) {
      return false;
    }
  }

  if (config.visibility === "public" && config.opponentType === "all_human") {
    return false;
  }

  if (requiresScheduledDraft(config) && !config.scheduledDraftAt) {
    return false;
  }

  if (config.visibility === "private" && config.opponentType === "all_human") {
    if (config.playerCount !== 2) return false;
    if (!config.inviteEmail?.trim()) return false;
  }

  return true;
}

/** @deprecated use isHumanLeagueSupported */
export function isHumanLeaguePoCSupported(config: CreateLeagueConfig): boolean {
  return isHumanLeagueSupported(config);
}

export function unsupportedLeagueConfigMessage(config: CreateLeagueConfig): string {
  if (config.formatType === "sports_league" && !config.sportsLeagueId) {
    return "Choose a sports league format (SDFL, SDHL, SDBA, or SDLB).";
  }

  const allowedCounts = playerCountsForFormat(config.formatType);
  if (!allowedCounts.includes(config.playerCount)) {
    return `${config.playerCount} players is not available for this format.`;
  }

  if (config.visibility === "public" && config.opponentType === "all_human") {
    return "Public leagues use bot fill for open slots — choose Mixed or All AI opponents.";
  }

  if (requiresScheduledDraft(config) && !config.scheduledDraftAt) {
    return "Set a scheduled draft date and time for this league.";
  }

  if (
    config.visibility === "private" &&
    config.opponentType === "all_human" &&
    config.playerCount !== 2
  ) {
    return "Private all-human leagues currently support 2 players with an email invite.";
  }

  if (
    config.visibility === "private" &&
    config.opponentType === "all_human" &&
    !config.inviteEmail?.trim()
  ) {
    return "A valid invite email is required for private head-to-head leagues.";
  }

  return "This league configuration is not available yet.";
}
