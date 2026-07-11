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

/** Fixed franchise counts per sports sim league (mirrors real league sizes). */
export const SPORTS_LEAGUE_REQUIRED_PLAYER_COUNT: Record<
  (typeof SPORTS_LEAGUE_FORMATS)[number]["id"],
  LeaguePlayerCount
> = {
  sdfl: 32,
  sdhl: 32,
  sdba: 30,
  sdlb: 30,
};

export const SPORTS_LEAGUE_FORMATS = [
  {
    id: "sdfl",
    label: "SDFL",
    description: "StockDraft Football League",
    logoSrc: "/images/leagues/sdfl.png",
  },
  {
    id: "sdhl",
    label: "SDHL",
    description: "StockDraft Hockey League",
    logoSrc: null,
  },
  {
    id: "sdba",
    label: "SDBA",
    description: "StockDraft Basketball Association",
    logoSrc: "/images/leagues/sdba.png",
  },
  {
    id: "sdlb",
    label: "SDLB",
    description: "StockDraft League Baseball",
    logoSrc: null,
  },
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
  /** all_ai leagues only — fast-timer override for bot-heavy test drafts (10-600s). */
  pickTimeSeconds?: number;
};

export const FAST_TIMER_MIN_SECONDS = 10;
export const FAST_TIMER_MAX_SECONDS = 600;
export const FAST_TIMER_PRESETS = [10, 15, 30, 60] as const;

export function playerCountForSportsLeague(
  sportsLeagueId: string | undefined
): LeaguePlayerCount | null {
  if (!sportsLeagueId) return null;
  const id = sportsLeagueId.toLowerCase() as keyof typeof SPORTS_LEAGUE_REQUIRED_PLAYER_COUNT;
  return SPORTS_LEAGUE_REQUIRED_PLAYER_COUNT[id] ?? null;
}

export function playerCountsForFormat(
  formatType: LeagueFormatType,
  sportsLeagueId?: string
): LeaguePlayerCount[] {
  if (formatType === "sports_league") {
    const required = playerCountForSportsLeague(sportsLeagueId);
    return required != null ? [required] : SPORTS_LEAGUE_PLAYER_COUNTS;
  }
  return STANDARD_PLAYER_COUNTS;
}

export function requiresScheduledDraft(config: CreateLeagueConfig): boolean {
  // Multi-player private all-human leagues use a commissioner-set draft time.
  if (config.visibility === "private" && config.opponentType === "all_human") {
    return config.playerCount > 2;
  }
  return (
    config.visibility === "public" ||
    config.opponentType !== "all_human" ||
    config.playerCount > 2
  );
}

export function isHumanLeagueSupported(config: CreateLeagueConfig): boolean {
  if (config.formatType === "sports_league") {
    if (!config.sportsLeagueId) return false;
    if (!SPORTS_LEAGUE_FORMATS.some((format) => format.id === config.sportsLeagueId)) {
      return false;
    }
    const requiredCount = playerCountForSportsLeague(config.sportsLeagueId);
    if (requiredCount == null || config.playerCount !== requiredCount) return false;
  } else {
    const allowedCounts = playerCountsForFormat(config.formatType);
    if (!allowedCounts.includes(config.playerCount)) return false;
  }

  if (config.visibility === "public" && config.opponentType === "all_human") {
    return false;
  }

  if (requiresScheduledDraft(config) && !config.scheduledDraftAt) {
    return false;
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

  if (config.formatType === "sports_league" && config.sportsLeagueId) {
    const requiredCount = playerCountForSportsLeague(config.sportsLeagueId);
    if (requiredCount != null && config.playerCount !== requiredCount) {
      const label =
        SPORTS_LEAGUE_FORMATS.find((f) => f.id === config.sportsLeagueId)?.label ??
        config.sportsLeagueId.toUpperCase();
      return `${label} requires exactly ${requiredCount} teams.`;
    }
  } else {
    const allowedCounts = playerCountsForFormat(config.formatType);
    if (!allowedCounts.includes(config.playerCount)) {
      return `${config.playerCount} players is not available for this format.`;
    }
  }

  if (config.visibility === "public" && config.opponentType === "all_human") {
    return "Public leagues use bot fill for open slots — choose Mixed or All AI opponents.";
  }

  if (requiresScheduledDraft(config) && !config.scheduledDraftAt) {
    return "Set a scheduled draft date and time for this league.";
  }

  return "This league configuration is not available yet.";
}
